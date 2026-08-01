import "server-only";

import { z } from "zod";

import type { MessageMutation } from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import { StalwartJmapMethodError } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-client-helpers";
import type { StalwartMailReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.reader";
import { jmapSetResultSchema } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.schema";
import { prepareStalwartMessageMove } from "@/infrastructure/providers/stalwart-jmap/stalwart-message-move";
import { JMAP_MAIL } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

const destroySourceSchema = z.object({
  accountId: z.string().min(1),
  list: z.array(z.object({
    id: z.string().min(1),
    mailboxIds: z.record(z.string(), z.boolean()),
  })).max(1),
  notFound: z.array(z.string()).max(1),
  state: z.string().min(1),
}).passthrough();

const labelSourceSchema = z.object({
  accountId: z.string().min(1),
  list: z.array(z.object({
    id: z.string().min(1),
    keywords: z.record(z.string(), z.boolean()),
    mailboxIds: z.record(z.string(), z.boolean()),
  })).max(1),
  notFound: z.array(z.string()).max(1),
  state: z.string().min(1),
}).passthrough();
const mailCapabilitySchema = z.object({
  maxKeywordsPerEmail: z.number().int().nonnegative().optional(),
}).passthrough();

const destroyState = async (
  client: StalwartJmapClient,
  accountId: string,
  mutation: Extract<MessageMutation, { readonly type: "destroy" }>,
): Promise<string> => {
  const response = await client.request(
    [["Email/get", {
      accountId,
      ids: [mutation.messageId],
      properties: ["id", "mailboxIds"],
    }, "destroy-source"]],
    [JMAP_MAIL],
  );
  const result = client.result(
    response, "destroy-source", "Email/get", destroySourceSchema,
  );
  const message = result.list[0];
  if (
    result.accountId !== accountId ||
    message?.id !== mutation.messageId ||
    message.mailboxIds[mutation.mailboxId] !== true
  ) {
    throw new Error("Message is outside the confirmed mailbox.");
  }
  return result.state;
};

const labelState = async (
  client: StalwartJmapClient,
  reader: StalwartMailReader,
  accountId: string,
  mutation: Extract<MessageMutation, { readonly type: "set-label" }>,
): Promise<{ readonly achieved: boolean; readonly state: string }> => {
  const response = await client.request(
    [["Email/get", {
      accountId,
      ids: [mutation.messageId],
      properties: ["id", "keywords", "mailboxIds"],
    }, "label-source"]],
    [JMAP_MAIL],
  );
  const result = client.result(
    response, "label-source", "Email/get", labelSourceSchema,
  );
  const message = result.list[0];
  if (result.accountId !== accountId || message?.id !== mutation.messageId) {
    throw new Error("Message not found for label update.");
  }
  const snapshot = await reader.getMailboxSnapshot();
  const rights = new Map(snapshot.mailboxes.map((mailbox) => [mailbox.id, mailbox.rights]));
  const containing = Object.keys(message.mailboxIds)
    .filter((mailboxId) => message.mailboxIds[mailboxId] === true);
  if (
    snapshot.accountId !== accountId ||
    containing.length === 0 ||
    containing.some((mailboxId) => rights.get(id.mailbox(mailboxId))?.maySetKeywords !== true)
  ) {
    throw new Error("The mail server denied label changes for this message.");
  }
  if (mutation.value && !message.keywords[mutation.labelId]) {
    const capability = mailCapabilitySchema.safeParse(
      (await client.getSession()).capabilities[JMAP_MAIL],
    );
    const maximum = capability.success
      ? capability.data.maxKeywordsPerEmail
      : undefined;
    const keywordCount = Object.values(message.keywords).filter(Boolean).length;
    if (maximum !== undefined && keywordCount >= maximum) {
      throw new Error("This message has reached the mail server's label limit.");
    }
  }
  return {
    achieved: Boolean(message.keywords[mutation.labelId]) === mutation.value,
    state: result.state,
  };
};

const targetMailbox = async (
  reader: StalwartMailReader,
  mutation: Exclude<
    MessageMutation,
    { readonly type: "destroy" } | { readonly type: "move" }
  >,
): Promise<string> => {
  const role =
    mutation.type === "delete"
      ? "trash"
      : mutation.type === "restore"
        ? "inbox"
        : "archive";
  const mailbox = (await reader.listMailboxes()).find(
    (candidate) => candidate.role === role,
  );
  if (!mailbox) throw new Error(`The ${role} mailbox is not configured.`);
  return mailbox.id;
};

export const mutateStalwartMessage = async (
  client: StalwartJmapClient,
  reader: StalwartMailReader,
  mutation: MessageMutation,
  attempt = 0,
): Promise<void> => {
  const accountId = await reader.getAccountId();
  const label = mutation.type === "set-label"
    ? await labelState(client, reader, accountId, mutation)
    : null;
  const move = mutation.type === "move"
    ? await prepareStalwartMessageMove(client, reader, accountId, mutation)
    : null;
  if (label?.achieved || move?.achieved) return;
  const ifInState = mutation.type === "destroy"
    ? await destroyState(client, accountId, mutation)
    : label?.state ?? move?.state ?? null;
  const arguments_ =
    mutation.type === "destroy"
      ? { accountId, destroy: [mutation.messageId], ifInState }
      : mutation.type === "move"
        ? {
            accountId,
            ifInState,
            update: {
              [mutation.messageId]: {
                ...move?.patch,
              },
            },
          }
      : {
          accountId,
          ...(ifInState ? { ifInState } : {}),
          update: {
            [mutation.messageId]:
              mutation.type === "set-read"
                ? { "keywords/$seen": mutation.value ? true : null }
                : mutation.type === "set-starred"
                  ? { "keywords/$flagged": mutation.value ? true : null }
                  : mutation.type === "set-label"
                    ? { [`keywords/${mutation.labelId}`]: mutation.value ? true : null }
                  : {
                      mailboxIds: {
                        [await targetMailbox(reader, mutation)]: true,
                      },
                    },
          },
        };
  try {
    const response = await client.request(
      [["Email/set", arguments_, "mutation"]],
      [JMAP_MAIL],
    );
    const result = client.result(
      response,
      "mutation",
      "Email/set",
      jmapSetResultSchema,
    );
    const rejected =
      mutation.type === "destroy" ? result.notDestroyed : result.notUpdated;
    if (rejected && Object.keys(rejected).length > 0) {
      const rejection = Object.values(rejected)[0];
      const rejectionType = typeof rejection === "object" && rejection &&
        "type" in rejection ? String(rejection.type) : "";
      throw new Error(rejectionType === "tooManyKeywords"
        ? "This message has reached the mail server's label limit."
        : "Stalwart rejected the message update.");
    }
    if (
      (result.accountId && result.accountId !== accountId) ||
      (mutation.type !== "destroy" &&
        !Object.hasOwn(result.updated ?? {}, mutation.messageId))
    ) {
      throw new Error("Stalwart did not confirm the message update.");
    }
  } catch (error) {
    if (
      (mutation.type === "set-label" || mutation.type === "move") &&
      attempt === 0 &&
      error instanceof StalwartJmapMethodError &&
      error.type === "stateMismatch"
    ) {
      return mutateStalwartMessage(client, reader, mutation, 1);
    }
    throw error;
  }
};
