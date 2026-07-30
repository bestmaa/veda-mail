import "server-only";
import type { Attachment } from "@/domain/mail/mail";
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
import {
  JMAP_BODY_TRUNCATION_TEXT,
  MAX_JMAP_BODY_VALUE_CHARACTERS,
  MAX_JMAP_RENDERED_BODY_CHARACTERS,
  type JmapBodyPart,
  type JmapEmail,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

interface BodyValue {
  readonly isTruncated: boolean;
  readonly type: string;
  readonly value: string;
}
interface BodyValueSelection {
  readonly isTruncated: boolean;
  readonly values: readonly BodyValue[];
}
export type JmapMessagePresentationEmail = Pick<
  JmapEmail,
  "attachments" | "bodyValues" | "bodyValuesTruncated" | "htmlBody" | "id"
>;
const mediaType = (part: JmapBodyPart): string =>
  part.type.split(";", 1)[0]?.trim().toLowerCase() ?? "";

const selectBodyValues = (
  parts: readonly JmapBodyPart[] | undefined,
  email: Pick<JmapEmail, "bodyValues" | "bodyValuesTruncated">,
): BodyValueSelection => {
  const seenPartIds = new Set<string>();
  const values: BodyValue[] = [];
  let remaining = MAX_JMAP_BODY_VALUE_CHARACTERS;
  let isTruncated = false;
  for (const part of parts ?? []) {
    const partId = part.partId;
    if (!partId || seenPartIds.has(partId)) continue;
    const bodyValue = email.bodyValues?.[partId];
    if (!bodyValue) {
      isTruncated ||= Boolean(email.bodyValuesTruncated);
      continue;
    }
    seenPartIds.add(partId);
    const value = bodyValue.value.slice(0, remaining);
    remaining -= value.length;
    const valueIsTruncated =
      bodyValue.isTruncated === true || value.length < bodyValue.value.length;
    isTruncated ||= valueIsTruncated;
    values.push({
      isTruncated: valueIsTruncated,
      type: mediaType(part),
      value,
    });
  }
  return { isTruncated, values };
};

const withTextTruncation = (value: string, isTruncated: boolean): string => {
  const needsMarker =
    isTruncated || value.length > MAX_JMAP_RENDERED_BODY_CHARACTERS;
  if (!needsMarker) return value;
  const marker = JMAP_BODY_TRUNCATION_TEXT;
  const separator = value ? "\n\n" : "";
  const available =
    MAX_JMAP_RENDERED_BODY_CHARACTERS - marker.length - separator.length;
  const prefix = value.slice(0, Math.max(0, available)).trimEnd();
  return prefix ? `${prefix}\n\n${marker}` : marker;
};

const renderTextValues = (selection: BodyValueSelection): string => {
  let output = "";
  let isTruncated = selection.isTruncated;
  for (const { type, value } of selection.values) {
    const fragment =
      type === "text/plain"
        ? value
        : type === "text/html"
          ? mailHtmlToPlainText(value)
          : "";
    if (!fragment) continue;
    const candidate = output ? `\n${fragment}` : fragment;
    const available = MAX_JMAP_RENDERED_BODY_CHARACTERS - output.length;
    output += candidate.slice(0, Math.max(0, available));
    isTruncated ||= candidate.length > available;
  }
  return withTextTruncation(output, isTruncated);
};

export const jmapTextBodyValue = (email: JmapEmail): string => {
  const text = selectBodyValues(email.textBody, email);
  if (text.values.length > 0 || text.isTruncated) {
    return renderTextValues(text);
  }
  const html = selectBodyValues(email.htmlBody, email);
  if (html.values.length > 0 || html.isTruncated) {
    return renderTextValues(html);
  }
  return withTextTruncation(
    email.preview,
    email.preview.length > MAX_JMAP_RENDERED_BODY_CHARACTERS,
  );
};

const replacements: Readonly<Record<string, string>> = {
  '"': "&quot;",
  "&": "&amp;",
  "'": "&#39;",
  "<": "&lt;",
  ">": "&gt;",
};
const escapeHtmlBounded = (
  value: string,
  maximumCharacters: number,
): { readonly isTruncated: boolean; readonly value: string } => {
  let escaped = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? "";
    const replacement = replacements[character] ?? character;
    if (escaped.length + replacement.length > maximumCharacters) {
      return { isTruncated: true, value: escaped };
    }
    escaped += replacement;
  }
  return { isTruncated: false, value: escaped };
};

const escapedMetadata = (value: string): string =>
  escapeHtmlBounded(value, MAX_JMAP_RENDERED_BODY_CHARACTERS).value;

const finalHtml = (
  value: string,
  isTruncated: boolean,
  inlineImages: readonly ReturnType<typeof jmapInlineImageCandidates>[number][],
): string | null => {
  const sanitized = sanitizeMailHtml(value, { inlineImages });
  const needsMarker =
    isTruncated || sanitized.length > MAX_JMAP_RENDERED_BODY_CHARACTERS;
  if (!needsMarker) return sanitized || null;
  const marker = `<p><em>${JMAP_BODY_TRUNCATION_TEXT}</em></p>`;
  const excerptLimit =
    MAX_JMAP_RENDERED_BODY_CHARACTERS - marker.length - 11;
  const excerpt = escapeHtmlBounded(
    mailHtmlToPlainText(sanitized),
    Math.max(0, excerptLimit),
  ).value;
  const marked = sanitizeMailHtml(
    `${marker}<pre>${excerpt}</pre>`,
    { inlineImages },
  );
  return marked.length <= MAX_JMAP_RENDERED_BODY_CHARACTERS
    ? marked
    : sanitizeMailHtml(marker, { inlineImages });
};

const jmapHtmlBodyValue = (
  email: JmapMessagePresentationEmail,
  attachments: readonly JmapReceivedAttachment[],
): string | null => {
  const inlineImages = jmapInlineImageCandidates(attachments);
  const sequentialImages = jmapSequentialInlineImages(
    email.htmlBody,
    attachments,
  );
  const seenPartIds = new Set<string>();
  let hasHtmlPresentation = false;
  let html = "";
  let remainingSource = MAX_JMAP_BODY_VALUE_CHARACTERS;
  let isTruncated = false;
  const append = (fragment: string): void => {
    const available = MAX_JMAP_RENDERED_BODY_CHARACTERS - html.length;
    html += fragment.slice(0, Math.max(0, available));
    isTruncated ||= fragment.length > available;
  };
  for (const [index, part] of (email.htmlBody ?? []).entries()) {
    const sequentialImage = sequentialImages[index];
    if (sequentialImage) {
      hasHtmlPresentation = true;
      append(
        `<img src="cid:${escapedMetadata(
          encodeURIComponent(sequentialImage.contentId),
        )}" alt="${escapedMetadata(sequentialImage.name)}">`,
      );
      continue;
    }
    const partId = part.partId;
    if (!partId || seenPartIds.has(partId)) continue;
    const bodyValue = email.bodyValues?.[partId];
    if (!bodyValue) {
      isTruncated ||= Boolean(email.bodyValuesTruncated);
      continue;
    }
    seenPartIds.add(partId);
    const type = mediaType(part);
    const source = bodyValue.value.slice(0, remainingSource);
    remainingSource -= source.length;
    isTruncated ||=
      bodyValue.isTruncated === true || source.length < bodyValue.value.length;
    if (type === "text/html") {
      hasHtmlPresentation ||= Boolean(bodyValue.value);
      append(sanitizeMailHtml(source, { inlineImages }));
      continue;
    }
    if (type !== "text/plain") continue;
    const available = Math.max(
      0,
      MAX_JMAP_RENDERED_BODY_CHARACTERS - html.length - 11,
    );
    const escaped = escapeHtmlBounded(source, available);
    isTruncated ||= escaped.isTruncated;
    append(`<pre>${escaped.value}</pre>`);
  }
  return hasHtmlPresentation
    ? finalHtml(html, isTruncated, inlineImages)
    : null;
};

export const jmapMessagePresentation = (
  email: JmapMessagePresentationEmail,
  accountId: string,
): {
  readonly attachments: readonly Attachment[];
  readonly htmlBody: string | null;
} => {
  const attachments = bindJmapReceivedAttachments(accountId, email);
  const htmlBody = jmapHtmlBodyValue(email, attachments);
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
