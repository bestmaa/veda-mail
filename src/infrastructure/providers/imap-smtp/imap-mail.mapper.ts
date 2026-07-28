import "server-only";

import type {
  FetchMessageObject,
  ListResponse,
  MessageAddressObject,
  MessageStructureObject,
} from "imapflow";
import type { AddressObject, ParsedMail } from "mailparser";

import type {
  MailAddress,
  Mailbox,
  MailboxRole,
  MessageDetail,
  MessageSummary,
} from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import {
  encodeMailboxId,
  encodeMessageId,
} from "@/infrastructure/providers/imap-smtp/imap-codec";
import { sanitizeMailHtml } from "@/infrastructure/providers/sanitize-mail-html";

const colors: Record<MailboxRole, string> = {
  archive: "#10b981",
  custom: "#64748b",
  drafts: "#f59e0b",
  inbox: "#4f46e5",
  sent: "#0ea5e9",
  spam: "#f97316",
  trash: "#ef4444",
};

const specialRoles: Record<string, MailboxRole> = {
  "\\archive": "archive",
  "\\drafts": "drafts",
  "\\inbox": "inbox",
  "\\junk": "spam",
  "\\sent": "sent",
  "\\trash": "trash",
};

const roleFor = (mailbox: ListResponse): MailboxRole =>
  mailbox.path.toUpperCase() === "INBOX"
    ? "inbox"
    : specialRoles[mailbox.specialUse?.toLowerCase() ?? ""] ?? "custom";

const envelopeAddresses = (
  values?: readonly MessageAddressObject[],
): readonly MailAddress[] =>
  (values ?? [])
    .filter((value) => Boolean(value.address))
    .map((value) => ({
      email: value.address ?? "",
      name: value.name ?? null,
    }));

const parsedAddresses = (
  value?: AddressObject | AddressObject[],
): readonly MailAddress[] =>
  (Array.isArray(value) ? value : value ? [value] : []).flatMap((group) =>
    group.value.map((address) => ({
      email: address.address ?? "",
      name: address.name || null,
    })),
  );

const hasAttachment = (node?: MessageStructureObject): boolean =>
  Boolean(
    node &&
      (node.disposition?.toLowerCase() === "attachment" ||
        node.childNodes?.some(hasAttachment)),
  );

export const mapImapMailbox = (mailbox: ListResponse): Mailbox => {
  const role = roleFor(mailbox);
  return {
    color: colors[role],
    id: id.mailbox(encodeMailboxId(mailbox.path)),
    name: mailbox.name || mailbox.path,
    role,
    total: mailbox.status?.messages ?? 0,
    unread: mailbox.status?.unseen ?? 0,
  };
};

export const mapImapSummary = (
  mailbox: string,
  message: FetchMessageObject,
): MessageSummary => {
  const messageId = encodeMessageId({ mailbox, uid: message.uid });
  const received =
    message.internalDate instanceof Date
      ? message.internalDate
      : new Date(message.internalDate ?? message.envelope?.date ?? Date.now());
  return {
    from: envelopeAddresses(message.envelope?.from),
    hasAttachment: hasAttachment(message.bodyStructure),
    id: id.message(messageId),
    isStarred: message.flags?.has("\\Flagged") ?? false,
    isUnread: !(message.flags?.has("\\Seen") ?? false),
    mailboxIds: [id.mailbox(encodeMailboxId(mailbox))],
    preview: "",
    receivedAt: received.toISOString(),
    size: message.size ?? 0,
    subject: message.envelope?.subject || "(No subject)",
    threadId: id.thread(
      message.threadId ?? message.envelope?.messageId ?? messageId,
    ),
    to: envelopeAddresses(message.envelope?.to),
  };
};

export const mapParsedMessage = (
  summary: MessageSummary,
  parsed: ParsedMail,
): MessageDetail => ({
  ...summary,
  attachments: parsed.attachments.map((attachment, index) => ({
    id: attachment.cid || `attachment-${index + 1}`,
    mimeType: attachment.contentType,
    name: attachment.filename || `Attachment ${index + 1}`,
    size: attachment.size,
  })),
  cc: parsedAddresses(parsed.cc),
  htmlBody:
    typeof parsed.html === "string"
      ? sanitizeMailHtml(parsed.html)
      : null,
  replyTo: parsedAddresses(parsed.replyTo),
  textBody: parsed.text ?? parsed.textAsHtml?.replace(/<[^>]+>/g, "") ?? "",
});
