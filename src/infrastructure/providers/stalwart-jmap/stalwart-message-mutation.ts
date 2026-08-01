import "server-only";

import { z } from "zod";

import type { MessageMutation } from "@/domain/mail/mail";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import type { StalwartMailReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.reader";
import { jmapSetResultSchema } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.schema";
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

const targetMailbox = async (
  reader: StalwartMailReader,
  mutation: Exclude<MessageMutation, { readonly type: "destroy" }>,
): Promise<string> => {
  if (mutation.type === "move") return mutation.mailboxId;
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
): Promise<void> => {
  const accountId = await reader.getAccountId();
  const ifInState = mutation.type === "destroy"
    ? await destroyState(client, accountId, mutation)
    : null;
  const arguments_ =
    mutation.type === "destroy"
      ? { accountId, destroy: [mutation.messageId], ifInState }
      : {
          accountId,
          update: {
            [mutation.messageId]:
              mutation.type === "set-read"
                ? { "keywords/$seen": mutation.value ? true : null }
                : mutation.type === "set-starred"
                  ? { "keywords/$flagged": mutation.value ? true : null }
                  : {
                      mailboxIds: {
                        [await targetMailbox(reader, mutation)]: true,
                      },
                    },
          },
        };
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
    throw new Error("Stalwart rejected the message update.");
  }
};
