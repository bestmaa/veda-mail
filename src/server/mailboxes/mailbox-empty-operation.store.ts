import "server-only";

import { randomBytes } from "node:crypto";

import {
  MAILBOX_EMPTY_MAX_CURSOR_CHARACTERS,
  type MailboxEmptyOperation,
  type MailboxEmptyResult,
  type MailboxEmptyUpdate,
} from "@/domain/mail/mailbox-empty";
import type { LabelOwner } from "@/domain/mail/label";
import type { MailboxId } from "@/domain/shared/brand";
import {
  readLabelCatalog,
  writeLabelCatalog,
} from "@/server/labels/label-catalog-access";
import { ApiError } from "@/transport/http/api-error";

interface EmptyClaim {
  readonly cursor: string | null;
  readonly leaseId: string;
  readonly mailboxId: MailboxId;
}

const progress = (
  operation: {
    mailboxId: string;
    processed: number;
    removed: number;
    startedAt: string;
    updatedAt: string;
  },
): MailboxEmptyOperation => ({
  mailboxId: operation.mailboxId as MailboxId,
  processed: operation.processed,
  removed: operation.removed,
  startedAt: operation.startedAt,
  updatedAt: operation.updatedAt,
});

const assertProgress = (result: MailboxEmptyResult): void => {
  const cursorValid = result.complete
    ? result.cursor === null
    : typeof result.cursor === "string" &&
      result.cursor.length >= 1 &&
      result.cursor.length <= MAILBOX_EMPTY_MAX_CURSOR_CHARACTERS &&
      /^[A-Za-z0-9_-]+$/u.test(result.cursor);
  if (
    !cursorValid ||
    !Number.isSafeInteger(result.processed) ||
    result.processed < 0 ||
    !Number.isSafeInteger(result.removed) ||
    result.removed < 0 ||
    result.removed > result.processed
  ) {
    throw new ApiError(
      "The provider returned invalid mailbox cleanup progress.",
      "MAILBOX_EMPTY_INVALID_PROGRESS",
      502,
    );
  }
};

export const mailboxEmptyOperationStore = {
  async list(owner: LabelOwner): Promise<readonly MailboxEmptyOperation[]> {
    return (await readLabelCatalog(owner)).mailboxEmptyOperations
      .filter((operation) => operation.cursor !== null)
      .map(progress);
  },

  async claim(owner: LabelOwner, mailboxId: MailboxId): Promise<EmptyClaim> {
    const leaseId = randomBytes(32).toString("base64url");
    const updated = await writeLabelCatalog(owner, (catalog) => {
      const existing = catalog.mailboxEmptyOperations.find(
        (operation) => operation.mailboxId === mailboxId,
      );
      const now = new Date();
      if (existing?.lease && Date.parse(existing.lease.expiresAt) > now.getTime()) {
        throw new ApiError(
          "This mailbox cleanup is already running.",
          "MAILBOX_EMPTY_BUSY",
          409,
        );
      }
      const timestamp = now.toISOString();
      const operation = {
        cursor: existing?.cursor ?? null,
        lease: {
          expiresAt: new Date(now.getTime() + 60_000).toISOString(),
          id: leaseId,
        },
        mailboxId,
        processed: existing?.processed ?? 0,
        removed: existing?.removed ?? 0,
        startedAt: existing?.startedAt ?? timestamp,
        updatedAt: timestamp,
      };
      return {
        ...catalog,
        mailboxEmptyOperations: [
          ...catalog.mailboxEmptyOperations.filter(
            (candidate) => candidate.mailboxId !== mailboxId,
          ),
          operation,
        ],
        updatedAt: timestamp,
      };
    });
    const operation = updated.mailboxEmptyOperations.find(
      (candidate) => candidate.mailboxId === mailboxId,
    )!;
    return { cursor: operation.cursor, leaseId, mailboxId };
  },

  async cancel(owner: LabelOwner, mailboxId: MailboxId): Promise<void> {
    await writeLabelCatalog(owner, (catalog) => ({
      ...catalog,
      mailboxEmptyOperations: catalog.mailboxEmptyOperations.filter(
        (operation) => operation.mailboxId !== mailboxId,
      ),
      updatedAt: new Date().toISOString(),
    }));
  },

  async record(
    owner: LabelOwner,
    claim: EmptyClaim,
    result: MailboxEmptyResult,
  ): Promise<MailboxEmptyUpdate> {
    assertProgress(result);
    let update: MailboxEmptyUpdate | null = null;
    await writeLabelCatalog(owner, (catalog) => {
      const current = catalog.mailboxEmptyOperations.find(
        (operation) => operation.mailboxId === claim.mailboxId,
      );
      if (current?.lease?.id !== claim.leaseId) {
        throw new ApiError(
          "Mailbox cleanup progress is stale.",
          "MAILBOX_EMPTY_STALE",
          409,
        );
      }
      if (
        current.processed > Number.MAX_SAFE_INTEGER - result.processed ||
        current.removed > Number.MAX_SAFE_INTEGER - result.removed
      ) {
        throw new ApiError(
          "Mailbox cleanup progress exceeded its safe bound.",
          "MAILBOX_EMPTY_INVALID_PROGRESS",
          502,
        );
      }
      const timestamp = new Date().toISOString();
      const processed = current.processed + result.processed;
      const removed = current.removed + result.removed;
      update = { complete: result.complete, processed, removed };
      return {
        ...catalog,
        mailboxEmptyOperations: result.complete
          ? catalog.mailboxEmptyOperations.filter(
              (operation) => operation.mailboxId !== claim.mailboxId,
            )
          : catalog.mailboxEmptyOperations.map((operation) =>
              operation.mailboxId === claim.mailboxId
                ? {
                    ...operation,
                    cursor: result.cursor,
                    lease: null,
                    processed,
                    removed,
                    updatedAt: timestamp,
                  }
                : operation,
            ),
        updatedAt: timestamp,
      };
    });
    return update!;
  },

  async release(owner: LabelOwner, claim: EmptyClaim): Promise<void> {
    await writeLabelCatalog(owner, (catalog) => {
      const timestamp = new Date().toISOString();
      return {
        ...catalog,
        mailboxEmptyOperations: catalog.mailboxEmptyOperations.map(
          (operation) =>
            operation.mailboxId === claim.mailboxId &&
            operation.lease?.id === claim.leaseId
              ? { ...operation, lease: null, updatedAt: timestamp }
              : operation,
        ),
        updatedAt: timestamp,
      };
    });
  },

  async abandon(owner: LabelOwner, claim: EmptyClaim): Promise<void> {
    await writeLabelCatalog(owner, (catalog) => ({
      ...catalog,
      mailboxEmptyOperations: catalog.mailboxEmptyOperations.filter(
        (operation) =>
          operation.mailboxId !== claim.mailboxId ||
          operation.lease?.id !== claim.leaseId,
      ),
      updatedAt: new Date().toISOString(),
    }));
  },
};
