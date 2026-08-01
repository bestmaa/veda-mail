import "server-only";

import type {
  FetchMessageObject,
  ListResponse,
  MessageAddressObject,
} from "imapflow";
import type { AddressObject, ParsedMail } from "mailparser";

import type {
  MailAddress,
  Mailbox,
  MailboxRole,
  MessageDetail,
  MessageSummary,
} from "@/domain/mail/mail";
import { labelIdFromKeyword } from "@/domain/mail/label";
import { id } from "@/domain/shared/brand";
import {
  encodeMailboxId,
  encodeScopedImapMessageId,
} from "@/infrastructure/providers/imap-smtp/imap-codec";
import { hasImapDownloadableAttachment } from "@/infrastructure/providers/imap-smtp/imap-attachment-structure";
import { classifyImapMessagePresentation } from "@/infrastructure/providers/imap-smtp/imap-message-presentation";
import type { ImapReceivedAttachment } from "@/infrastructure/providers/imap-smtp/imap-received-attachment";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";
import { mailHtmlToPlainText } from "@/infrastructure/providers/sanitize-mail-html";

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
    : (specialRoles[mailbox.specialUse?.toLowerCase() ?? ""] ?? "custom");

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

export const mapImapMailbox = (mailbox: ListResponse): Mailbox => {
  const role = roleFor(mailbox);
  return {
    color: colors[role],
    id: id.mailbox(encodeMailboxId(mailbox.path)),
    name: mailbox.name || mailbox.path,
    parentId: mailbox.parentPath
      ? id.mailbox(encodeMailboxId(mailbox.parentPath))
      : null,
    role,
    rights: {
      mayCreateChild: !mailbox.flags.has("\\Noinferiors"),
      mayDelete: role === "custom",
      mayRemoveItems: true,
      mayRename: role === "custom",
    },
    sortOrder: 0,
    total: mailbox.status?.messages ?? 0,
    unread: mailbox.status?.unseen ?? 0,
  };
};

export const mapImapSummary = (
  mailbox: string,
  message: FetchMessageObject,
  identity: {
    readonly config: Pick<
      ImapSmtpMemberConfig,
      "imapHost" | "imapPort" | "username"
    >;
    readonly uidValidity: bigint;
  },
): MessageSummary => {
  const messageId = encodeScopedImapMessageId(identity.config, {
    mailbox,
    uid: message.uid,
    uidValidity: identity.uidValidity,
  });
  const received =
    message.internalDate instanceof Date
      ? message.internalDate
      : new Date(message.internalDate ?? message.envelope?.date ?? Date.now());
  return {
    from: envelopeAddresses(message.envelope?.from),
    hasAttachment: hasImapDownloadableAttachment(message.bodyStructure),
    id: id.message(messageId),
    isStarred: message.flags?.has("\\Flagged") ?? false,
    isUnread: !(message.flags?.has("\\Seen") ?? false),
    labelIds: [...(message.flags ?? [])].flatMap((flag) => {
      const labelId = labelIdFromKeyword(flag);
      return labelId ? [labelId] : [];
    }),
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
  receivedAttachments: readonly ImapReceivedAttachment[] = [],
): MessageDetail => {
  const presentation = classifyImapMessagePresentation(
    parsed,
    receivedAttachments,
  );
  return {
    ...summary,
    ...presentation,
    cc: parsedAddresses(parsed.cc),
    replyTo: parsedAddresses(parsed.replyTo),
    textBody:
      parsed.text ??
      (parsed.textAsHtml ? mailHtmlToPlainText(parsed.textAsHtml) : ""),
  };
};
