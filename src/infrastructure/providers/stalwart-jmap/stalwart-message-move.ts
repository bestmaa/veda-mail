import "server-only";

import { z } from "zod";

import type { MessageMutation } from "@/domain/mail/mail";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import type { StalwartMailReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.reader";
import { JMAP_MAIL } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

type MoveMutation = Extract<MessageMutation, { readonly type: "move" }>;

const moveSourceSchema = z.object({
  accountId: z.string().min(1),
  list: z.array(z.object({
    id: z.string().min(1),
    mailboxIds: z.record(z.string(), z.boolean()),
  })).max(1),
  notFound: z.array(z.string()).max(1),
  state: z.string().min(1),
}).passthrough();

const patchSegment = (value: string): string =>
  value.replaceAll("~", "~0").replaceAll("/", "~1");

export const prepareStalwartMessageMove = async (
  client: StalwartJmapClient,
  reader: StalwartMailReader,
  accountId: string,
  mutation: MoveMutation,
): Promise<{
  readonly achieved: boolean;
  readonly patch: Readonly<Record<string, boolean | null>>;
  readonly state: string;
}> => {
  const response = await client.request(
    [["Email/get", {
      accountId,
      ids: [mutation.messageId],
      properties: ["id", "mailboxIds"],
    }, "move-source"]],
    [JMAP_MAIL],
  );
  const result = client.result(
    response, "move-source", "Email/get", moveSourceSchema,
  );
  const message = result.list[0];
  if (result.accountId !== accountId || message?.id !== mutation.messageId) {
    throw new Error("Message not found for move.");
  }
  const hasSource = message.mailboxIds[mutation.sourceMailboxId] === true;
  const hasDestination =
    message.mailboxIds[mutation.destinationMailboxId] === true;
  const patch = {
    [`mailboxIds/${patchSegment(mutation.sourceMailboxId)}`]: null,
    [`mailboxIds/${patchSegment(mutation.destinationMailboxId)}`]: true,
  } as const;
  if (!hasSource && hasDestination) {
    return { achieved: true, patch, state: result.state };
  }
  const snapshot = await reader.getMailboxSnapshot();
  const source = snapshot.mailboxes.find(
    ({ id: mailboxId }) => mailboxId === mutation.sourceMailboxId,
  );
  const destination = snapshot.mailboxes.find(
    ({ id: mailboxId }) => mailboxId === mutation.destinationMailboxId,
  );
  if (
    snapshot.accountId !== accountId ||
    !hasSource ||
    !source ||
    source.rights.mayRemoveItems !== true
  ) {
    throw new Error("The message is no longer movable from its source mailbox.");
  }
  if (
    hasDestination ||
    !destination ||
    destination.rights.mayAddItems !== true ||
    destination.role === "drafts" ||
    destination.role === "sent"
  ) {
    throw new Error("The destination mailbox does not accept this message.");
  }
  return { achieved: false, patch, state: result.state };
};
