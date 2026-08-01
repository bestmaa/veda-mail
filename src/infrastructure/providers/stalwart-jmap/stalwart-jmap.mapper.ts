import "server-only";

import type {
  Attachment,
  MailAddress,
  Mailbox,
  MailboxRole,
  MessageDetail,
  MessageSummary,
} from "@/domain/mail/mail";
import { labelIdFromKeyword } from "@/domain/mail/label";
import { id } from "@/domain/shared/brand";
import {
  jmapMessagePresentation,
  jmapTextBodyValue,
  type JmapMessagePresentationEmail,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-body-presentation";
import type {
  JmapAddress,
  JmapEmail,
  JmapMailbox,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

const mailboxColors: Record<MailboxRole, string> = {
  archive: "#10b981",
  custom: "#64748b",
  drafts: "#f59e0b",
  inbox: "#4f46e5",
  sent: "#0ea5e9",
  spam: "#f97316",
  trash: "#ef4444",
};

const roles = new Set<MailboxRole>([
  "archive",
  "drafts",
  "inbox",
  "sent",
  "spam",
  "trash",
]);

const mailboxRole = (role?: string | null): MailboxRole => {
  if (role === "junk") {
    return "spam";
  }
  return role && roles.has(role as MailboxRole)
    ? (role as MailboxRole)
    : "custom";
};

const addresses = (
  values?: readonly JmapAddress[] | null,
): readonly MailAddress[] =>
  (values ?? []).map((address) => ({
    email: address.email,
    name: address.name ?? null,
  }));

export const mapVisibleMessageAttachments = (
  email: JmapMessagePresentationEmail,
  accountId = "",
): readonly Attachment[] =>
  jmapMessagePresentation(email, accountId).attachments.filter(
    ({ disposition }) => disposition === "attachment",
  );

export const mapMailbox = (mailbox: JmapMailbox): Mailbox => {
  const role = mailboxRole(mailbox.role);
  return {
    color: mailboxColors[role],
    id: id.mailbox(mailbox.id),
    name: mailbox.name,
    parentId: mailbox.parentId ? id.mailbox(mailbox.parentId) : null,
    role,
    rights: {
      mayAddItems: mailbox.myRights?.mayAddItems ?? false,
      mayCreateChild: mailbox.myRights?.mayCreateChild ?? false,
      mayDelete: role === "custom" && (mailbox.myRights?.mayDelete ?? false),
      mayRemoveItems: mailbox.myRights?.mayRemoveItems ?? false,
      mayRename: role === "custom" && (mailbox.myRights?.mayRename ?? false),
      maySetKeywords: mailbox.myRights?.maySetKeywords ?? false,
    },
    sortOrder: mailbox.sortOrder ?? 0,
    total: mailbox.totalEmails,
    unread: mailbox.unreadEmails,
  };
};

export const mapMessageSummary = (email: JmapEmail): MessageSummary => ({
  from: addresses(email.from),
  hasAttachment: email.hasAttachment,
  id: id.message(email.id),
  isStarred: Boolean(email.keywords["$flagged"]),
  isUnread: !email.keywords["$seen"],
  labelIds: Object.entries(email.keywords).flatMap(([keyword, enabled]) => {
    const labelId = enabled ? labelIdFromKeyword(keyword) : null;
    return labelId ? [labelId] : [];
  }),
  mailboxIds: Object.keys(email.mailboxIds).map(id.mailbox),
  preview: email.preview,
  receivedAt: email.receivedAt,
  size: email.size,
  subject: email.subject || "(No subject)",
  threadId: id.thread(email.threadId),
  to: addresses(email.to),
});

export const mapMessageDetail = (
  email: JmapEmail,
  accountId = "",
): MessageDetail => {
  const presentation = jmapMessagePresentation(email, accountId);
  return {
    ...mapMessageSummary(email),
    attachments: presentation.attachments,
    cc: addresses(email.cc),
    htmlBody: presentation.htmlBody,
    replyTo: addresses(email.replyTo),
    textBody: jmapTextBodyValue(email),
  };
};
