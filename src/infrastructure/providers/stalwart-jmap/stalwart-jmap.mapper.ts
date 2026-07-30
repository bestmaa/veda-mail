import "server-only";

import type {
  Attachment,
  MailAddress,
  Mailbox,
  MailboxRole,
  MessageDetail,
  MessageSummary,
} from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import {
  mailHtmlToPlainText,
  sanitizeMailHtml,
} from "@/infrastructure/providers/sanitize-mail-html";
import { renderedInlineImageAttachmentIds } from "@/infrastructure/providers/sanitize-inline-mail-images";
import {
  bindJmapReceivedAttachments,
  type JmapReceivedAttachment,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-attachment";
import {
  jmapInlineImageCandidates,
  jmapSequentialInlineImages,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-inline-image";
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

interface BodyValue {
  readonly type: string;
  readonly value: string;
}

type MessagePresentationEmail = Pick<
  JmapEmail,
  "attachments" | "bodyValues" | "htmlBody" | "id"
>;

const bodyValues = (
  parts: readonly JmapBodyPart[] | undefined,
  email: JmapEmail,
): readonly BodyValue[] => {
  const seenPartIds = new Set<string>();
  const values: BodyValue[] = [];
  for (const part of parts ?? []) {
    const partId = part.partId;
    if (!partId || seenPartIds.has(partId)) {
      continue;
    }
    const value = email.bodyValues?.[partId]?.value;
    if (value === undefined) {
      continue;
    }
    seenPartIds.add(partId);
    values.push({
      type: part.type.split(";", 1)[0]?.trim().toLowerCase() ?? "",
      value,
    });
  }
  return values;
};

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => {
    const replacements: Readonly<Record<string, string>> = {
      '"': "&quot;",
      "&": "&amp;",
      "'": "&#39;",
      "<": "&lt;",
      ">": "&gt;",
    };
    return replacements[character] ?? character;
  });

const textBodyValue = (email: JmapEmail): string => {
  const render = (values: readonly BodyValue[]) =>
    values
      .map(({ type, value }) => {
        if (type === "text/plain") {
          return value;
        }
        return type === "text/html" ? mailHtmlToPlainText(value) : "";
      })
      .filter(Boolean)
      .join("\n");
  return (
    render(bodyValues(email.textBody, email)) ||
    render(bodyValues(email.htmlBody, email)) ||
    email.preview
  );
};

const htmlBodyValue = (
  email: MessagePresentationEmail,
  attachments: readonly JmapReceivedAttachment[],
): string | null => {
  const inlineImages = jmapInlineImageCandidates(attachments);
  const sequentialImages = jmapSequentialInlineImages(
    email.htmlBody,
    attachments,
  );
  const seenPartIds = new Set<string>();
  let hasHtmlPresentation = false;
  const fragments = (email.htmlBody ?? []).map((part, index) => {
    const sequentialImage = sequentialImages[index];
    if (sequentialImage) {
      hasHtmlPresentation = true;
      const contentId = escapeHtml(
        encodeURIComponent(sequentialImage.contentId),
      );
      return `<img src="cid:${contentId}" alt="${escapeHtml(
        sequentialImage.name,
      )}">`;
    }
    const partId = part.partId;
    if (!partId || seenPartIds.has(partId)) return "";
    const value = email.bodyValues?.[partId]?.value;
    if (value === undefined) return "";
    seenPartIds.add(partId);
    const type =
      part.type.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    if (type === "text/html") {
      hasHtmlPresentation ||= Boolean(value);
      return sanitizeMailHtml(value, { inlineImages });
    }
    return type === "text/plain"
      ? `<pre>${escapeHtml(value)}</pre>`
      : "";
  });
  if (!hasHtmlPresentation) return null;
  const html = sanitizeMailHtml(fragments.join(""), {
    inlineImages,
  });
  return html || null;
};

interface MessagePresentation {
  readonly attachments: readonly Attachment[];
  readonly htmlBody: string | null;
}

const messagePresentation = (
  email: MessagePresentationEmail,
  accountId: string,
): MessagePresentation => {
  const attachments = bindJmapReceivedAttachments(accountId, email);
  const htmlBody = htmlBodyValue(email, attachments);
  const renderedInlineIds = renderedInlineImageAttachmentIds(htmlBody);
  return {
    attachments: attachments.map(({ metadata }) =>
      metadata.disposition === "inline" &&
      !renderedInlineIds.has(metadata.id)
        ? { ...metadata, disposition: "attachment" as const }
        : metadata,
    ),
    htmlBody,
  };
};

export const mapVisibleMessageAttachments = (
  email: MessagePresentationEmail,
  accountId = "",
): readonly Attachment[] =>
  messagePresentation(email, accountId).attachments.filter(
    ({ disposition }) => disposition === "attachment",
  );

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

export const mapMessageDetail = (
  email: JmapEmail,
  accountId = "",
): MessageDetail => {
  const presentation = messagePresentation(email, accountId);
  return {
    ...mapMessageSummary(email),
    attachments: presentation.attachments,
    cc: addresses(email.cc),
    htmlBody: presentation.htmlBody,
    replyTo: addresses(email.replyTo),
    textBody: textBodyValue(email),
  };
};
