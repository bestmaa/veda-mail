import "server-only";

import { createHmac } from "node:crypto";

import type { MailApplicationService } from "@/application/services/mail-application.service";
import {
  MAILBOX_EMPTY_MAX_BATCH,
  MailboxEmptyCursorError,
} from "@/domain/mail/mailbox-empty";
import type { LabelOwner } from "@/domain/mail/label";
import type { MailboxId } from "@/domain/shared/brand";
import { installationStore } from "@/server/installation/installation.store";
import { mailboxEmptyOperationStore } from "@/server/mailboxes/mailbox-empty-operation.store";
import { ApiError } from "@/transport/http/api-error";

const requireEmptyableMailbox = async (
  service: MailApplicationService,
  mailboxId: MailboxId,
) => {
  const mailbox = (await service.listMailboxes()).find(
    (candidate) => candidate.id === mailboxId,
  );
  if (!mailbox) {
    throw new ApiError("Mailbox not found.", "MAILBOX_EMPTY_NOT_FOUND", 404);
  }
  if (mailbox.role !== "spam" && mailbox.role !== "trash") {
    throw new ApiError(
      "Only Spam or Trash can be emptied.",
      "MAILBOX_EMPTY_FORBIDDEN",
      403,
    );
  }
  if (mailbox.rights.mayRemoveItems !== true) {
    throw new ApiError(
      "The mail provider does not allow removing items from this mailbox.",
      "MAILBOX_EMPTY_FORBIDDEN",
      403,
    );
  }
  return mailbox;
};

const cursorSecret = async (owner: LabelOwner): Promise<string> => {
  const installation = await installationStore.get();
  if (!installation) {
    throw new ApiError(
      "Mailbox cleanup is unavailable.",
      "MAILBOX_EMPTY_UNAVAILABLE",
      500,
    );
  }
  return createHmac("sha256", installation.sessionSecret)
    .update("veda-mail/mailbox-empty/cursor/v1\0")
    .update(owner.providerId.trim().toLowerCase()).update("\0")
    .update(owner.email.trim().toLowerCase())
    .digest("base64url");
};

export const emptyMailboxBatch = async (
  service: MailApplicationService,
  owner: LabelOwner,
  mailboxId: MailboxId,
) => {
  try {
    await requireEmptyableMailbox(service, mailboxId);
  } catch (error) {
    await mailboxEmptyOperationStore.cancel(owner, mailboxId).catch(() => undefined);
    throw error;
  }
  const claim = await mailboxEmptyOperationStore.claim(owner, mailboxId);
  try {
    const result = await service.emptyMailbox({
      ...(claim.cursor ? { cursor: claim.cursor } : {}),
      limit: MAILBOX_EMPTY_MAX_BATCH,
      mailboxId,
    }, await cursorSecret(owner));
    return await mailboxEmptyOperationStore.record(owner, claim, result);
  } catch (error) {
    if (error instanceof MailboxEmptyCursorError) {
      await mailboxEmptyOperationStore.abandon(owner, claim).catch(() => undefined);
      throw new ApiError(
        "This cleanup snapshot expired. Confirm emptying the mailbox again.",
        "MAILBOX_EMPTY_SNAPSHOT_EXPIRED",
        409,
      );
    }
    const settle = claim.cursor
      ? mailboxEmptyOperationStore.release(owner, claim)
      : mailboxEmptyOperationStore.abandon(owner, claim);
    await settle.catch(() => undefined);
    throw error;
  }
};
