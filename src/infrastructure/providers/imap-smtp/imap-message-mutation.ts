import "server-only";

import type { ListResponse } from "imapflow";

import type { MessageMutation } from "@/domain/mail/mail";
import {
  decodeMailboxId,
  decodeScopedImapMessageId,
  imapUidValidityMatches,
} from "@/infrastructure/providers/imap-smtp/imap-codec";
import { withImapClient } from "@/infrastructure/providers/imap-smtp/imap-client";
import { mutateImapLabel } from "@/infrastructure/providers/imap-smtp/imap-label-mutation";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";

const rolePath = (
  mailboxes: readonly ListResponse[],
  role: "archive" | "inbox" | "trash",
): string => {
  const special = role === "inbox" ? "\\Inbox" : `\\${role}`;
  const mailbox = mailboxes.find(
    (candidate) =>
      candidate.specialUse?.toLowerCase() === special.toLowerCase() ||
      (role === "inbox" && candidate.path.toUpperCase() === "INBOX"),
  );
  if (!mailbox) throw new Error(`No ${role} mailbox is configured.`);
  return mailbox.path;
};

export const mutateImapMessage = async (
  config: ImapSmtpMemberConfig,
  mutation: MessageMutation,
): Promise<void> => {
  let reference;
  try {
    reference = decodeScopedImapMessageId(config, mutation.messageId);
  } catch {
    throw new Error("Message not found.");
  }
  return withImapClient(config, async (client) => {
    const opened = await client.mailboxOpen(reference.mailbox);
    if (!imapUidValidityMatches(reference, opened.uidValidity)) {
      throw new Error("Message not found.");
    }
    if (opened.readOnly) throw new Error("The source mailbox is read-only.");
    if (mutation.type === "destroy") {
      if (!client.capabilities.has("UIDPLUS")) {
        throw new Error("Safe permanent deletion requires IMAP UIDPLUS.");
      }
      const deleted = await client.messageDelete(reference.uid, { uid: true });
      if (!deleted) throw new Error("Message not found.");
      return;
    }
    if (mutation.type === "set-label") {
      await mutateImapLabel(client, opened, reference.uid, mutation);
      return;
    }
    if (mutation.type === "set-read" || mutation.type === "set-starred") {
      const flag = mutation.type === "set-read" ? "\\Seen" : "\\Flagged";
      const update = mutation.value
        ? client.messageFlagsAdd.bind(client)
        : client.messageFlagsRemove.bind(client);
      await update(reference.uid, [flag], { uid: true });
      return;
    }
    if (
      mutation.type === "move" &&
      decodeMailboxId(mutation.sourceMailboxId) !== reference.mailbox
    ) {
      throw new Error("The message is outside the selected source mailbox.");
    }
    if (!client.capabilities.has("MOVE")) {
      throw new Error("Safe message moves require native IMAP MOVE support.");
    }
    const mailboxes = await client.list();
    const target = mutation.type === "move"
      ? decodeMailboxId(mutation.destinationMailboxId)
      : rolePath(
          mailboxes,
          mutation.type === "delete"
            ? "trash"
            : mutation.type === "restore" ? "inbox" : "archive",
        );
    const destination = mailboxes.find(({ path }) => path === target);
    if (!destination || destination.flags.has("\\Noselect")) {
      throw new Error("The destination mailbox does not accept messages.");
    }
    if (target === reference.mailbox) {
      throw new Error("Choose a different destination mailbox.");
    }
    const source = await client.fetchOne(
      reference.uid, { uid: true }, { uid: true },
    );
    if (!source || source.uid !== reference.uid) {
      throw new Error("Message not found.");
    }
    const moved = await client.messageMove(reference.uid, target, { uid: true });
    if (!moved) throw new Error("The mail server did not confirm the move.");
  });
};
