import "server-only";

import type {
  MailboxMutation,
  MailboxMutationResult,
} from "@/domain/mail/mail";
import {
  assertMailboxMutation,
  MailboxPolicyError,
} from "@/domain/mail/mailbox-policy";
import type { MailboxId } from "@/domain/shared/brand";
import { id } from "@/domain/shared/brand";
import {
  StalwartJmapMethodError,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-client-helpers";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import { jmapSetResultSchema } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.schema";
import { JMAP_MAIL } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";
import type { StalwartMailReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.reader";

const rejectedType = (value: unknown): string | null => {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return null;
  }
  return typeof value.type === "string" ? value.type : null;
};

const rejected = (
  mutation: MailboxMutation,
  result: {
    readonly notCreated?: Readonly<Record<string, unknown>> | null | undefined;
    readonly notDestroyed?: Readonly<Record<string, unknown>> | null | undefined;
    readonly notUpdated?: Readonly<Record<string, unknown>> | null | undefined;
  },
): unknown =>
  mutation.type === "create"
    ? result.notCreated?.["mailbox"]
    : mutation.type === "delete"
      ? result.notDestroyed?.[mutation.mailboxId]
      : result.notUpdated?.[mutation.mailboxId];

const throwRejected = (value: unknown): never => {
  const type = rejectedType(value);
  if (type === "mailboxHasEmail") {
    throw new MailboxPolicyError("mail-exists", "Empty this mailbox before deleting it.");
  }
  if (type === "mailboxHasChild") {
    throw new MailboxPolicyError(
      "child-exists",
      "Remove or move child mailboxes before deleting this mailbox.",
    );
  }
  if (type === "invalidProperties" || type === "invalidArguments") {
    throw new MailboxPolicyError("name", "The mailbox settings are invalid.");
  }
  if (type === "forbidden") {
    throw new MailboxPolicyError("forbidden", "The mail server denied this mailbox change.");
  }
  throw new Error("Stalwart rejected the mailbox change.");
};

const updatePatch = (
  mutation: Extract<MailboxMutation, { readonly type: "update" }>,
): Readonly<Record<string, unknown>> => ({
  ...(mutation.name === undefined ? {} : { name: mutation.name }),
  ...(mutation.parentId === undefined ? {} : { parentId: mutation.parentId }),
});

export class StalwartMailboxManager {
  public constructor(
    private readonly client: StalwartJmapClient,
    private readonly reader: StalwartMailReader,
  ) {}

  public async mutate(
    mutation: MailboxMutation,
  ): Promise<MailboxMutationResult> {
    const before = await this.reader.getMailboxSnapshot();
    assertMailboxMutation(before.mailboxes, mutation);
    const arguments_ =
      mutation.type === "create"
        ? {
            accountId: before.accountId,
            create: {
              mailbox: {
                isSubscribed: true,
                name: mutation.name,
                parentId: mutation.parentId,
                role: null,
                sortOrder: 1_000,
              },
            },
            ifInState: before.state,
          }
        : mutation.type === "update"
          ? {
              accountId: before.accountId,
              ifInState: before.state,
              update: { [mutation.mailboxId]: updatePatch(mutation) },
            }
          : {
              accountId: before.accountId,
              destroy: [mutation.mailboxId],
              ifInState: before.state,
              onDestroyRemoveEmails: false,
            };
    let result;
    try {
      const response = await this.client.request(
        [["Mailbox/set", arguments_, "mailbox-mutation"]],
        [JMAP_MAIL],
      );
      result = this.client.result(
        response,
        "mailbox-mutation",
        "Mailbox/set",
        jmapSetResultSchema,
      );
    } catch (error) {
      if (error instanceof StalwartJmapMethodError && error.type === "stateMismatch") {
        throw new MailboxPolicyError(
          "conflict",
          "Mailboxes changed in another session. Reload and try again.",
        );
      }
      throw error;
    }
    const rejection = rejected(mutation, result);
    if (rejection) throwRejected(rejection);
    if (result.accountId && result.accountId !== before.accountId) {
      throw new Error("Stalwart returned a mailbox account mismatch.");
    }
    if (
      mutation.type === "update" &&
      !Object.hasOwn(result.updated ?? {}, mutation.mailboxId)
    ) {
      throw new Error("Stalwart did not confirm the mailbox update.");
    }
    if (
      mutation.type === "delete" &&
      !result.destroyed?.includes(mutation.mailboxId)
    ) {
      throw new Error("Stalwart did not confirm the mailbox deletion.");
    }
    const mailboxId: MailboxId | null =
      mutation.type === "create"
        ? id.mailbox(result.created?.["mailbox"]?.id ?? "")
        : mutation.type === "update"
          ? mutation.mailboxId
          : null;
    if (mutation.type === "create" && !mailboxId) {
      throw new Error("Stalwart did not return the created mailbox identifier.");
    }
    return {
      mailboxId,
      mailboxes: await this.reader.listMailboxes(),
    };
  }
}
