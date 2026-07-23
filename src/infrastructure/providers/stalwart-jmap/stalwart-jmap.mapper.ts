import "server-only";

import sanitizeHtml from "sanitize-html";

import type {
  MailAddress,
  Mailbox,
  MailboxRole,
  MessageDetail,
  MessageSummary,
} from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import type {
  JmapAddress,
  JmapBodyPart,
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

const bodyValue = (
  parts: readonly JmapBodyPart[] | undefined,
  email: JmapEmail,
): string => {
  const partId = parts?.[0]?.partId;
  return partId ? (email.bodyValues?.[partId]?.value ?? "") : "";
};

export const mapMailbox = (mailbox: JmapMailbox): Mailbox => {
  const role = mailboxRole(mailbox.role);
  return {
    color: mailboxColors[role],
    id: id.mailbox(mailbox.id),
    name: mailbox.name,
    role,
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
  mailboxIds: Object.keys(email.mailboxIds).map(id.mailbox),
  preview: email.preview,
  receivedAt: email.receivedAt,
  size: email.size,
  subject: email.subject || "(No subject)",
  threadId: id.thread(email.threadId),
  to: addresses(email.to),
});

export const mapMessageDetail = (email: JmapEmail): MessageDetail => {
  const rawHtml = bodyValue(email.htmlBody, email);
  return {
    ...mapMessageSummary(email),
    attachments: (email.attachments ?? []).map((attachment, index) => ({
      id: attachment.blobId ?? `attachment-${index}`,
      mimeType: attachment.type,
      name: attachment.name ?? `Attachment ${index + 1}`,
      size: attachment.size ?? 0,
    })),
    cc: addresses(email.cc),
    htmlBody: rawHtml
      ? sanitizeHtml(rawHtml, {
          allowedAttributes: {
            a: ["href", "title"],
            blockquote: ["cite"],
            td: ["colspan", "rowspan"],
            th: ["colspan", "rowspan"],
          },
          allowedSchemes: ["http", "https", "mailto"],
          disallowedTagsMode: "discard",
        })
      : null,
    textBody: bodyValue(email.textBody, email) || email.preview,
  };
};
