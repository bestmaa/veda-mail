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

interface BodyValue {
  readonly type: string;
  readonly value: string;
}

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

const sanitizeBodyHtml = (value: string): string =>
  sanitizeHtml(value, {
    allowedAttributes: {
      a: ["href", "title"],
      blockquote: ["cite"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    disallowedTagsMode: "discard",
  });

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

const decodeHtmlEntities = (value: string): string => {
  const namedEntities: Readonly<Record<string, string>> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(
    /&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi,
    (entity, decimal: string, hexadecimal: string, named: string) => {
      const numericValue = decimal
        ? Number.parseInt(decimal, 10)
        : Number.parseInt(hexadecimal, 16);
      if (decimal || hexadecimal) {
        return Number.isSafeInteger(numericValue) &&
          numericValue >= 0 &&
          numericValue <= 0x10ffff
          ? String.fromCodePoint(numericValue)
          : entity;
      }
      return namedEntities[named.toLowerCase()] ?? entity;
    },
  );
};

const htmlToText = (value: string): string => {
  const safeHtml = sanitizeBodyHtml(value);
  return decodeHtmlEntities(
    safeHtml
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<li(?:\s[^>]*)?>/gi, "- ")
      .replace(/<\/(?:td|th)>/gi, "\t")
      .replace(
        /<\/(?:address|article|aside|blockquote|div|footer|h[1-6]|header|li|main|nav|ol|p|pre|section|table|tr|ul)>/gi,
        "\n",
      )
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const textBodyValue = (email: JmapEmail): string => {
  const render = (values: readonly BodyValue[]) =>
    values
      .map(({ type, value }) => {
        if (type === "text/plain") {
          return value;
        }
        return type === "text/html" ? htmlToText(value) : "";
      })
      .filter(Boolean)
      .join("\n");
  return (
    render(bodyValues(email.textBody, email)) ||
    render(bodyValues(email.htmlBody, email)) ||
    email.preview
  );
};

const htmlBodyValue = (email: JmapEmail): string | null => {
  const values = bodyValues(email.htmlBody, email);
  if (!values.some(({ type, value }) => type === "text/html" && value)) {
    return null;
  }
  const html = values
    .map(({ type, value }) => {
      if (type === "text/html") {
        return sanitizeBodyHtml(value);
      }
      return type === "text/plain" ? `<pre>${escapeHtml(value)}</pre>` : "";
    })
    .join("");
  return html || null;
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
  return {
    ...mapMessageSummary(email),
    attachments: (email.attachments ?? []).map((attachment, index) => ({
      id: attachment.blobId ?? `attachment-${index}`,
      mimeType: attachment.type,
      name: attachment.name ?? `Attachment ${index + 1}`,
      size: attachment.size ?? 0,
    })),
    cc: addresses(email.cc),
    htmlBody: htmlBodyValue(email),
    textBody: textBodyValue(email),
  };
};
