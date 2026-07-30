import { canonicalizeOutgoingLink } from "@/domain/mail/outgoing-content-policy";
import { MAX_OUTGOING_HTML_NODES } from "@/domain/mail/mail";

export const COMPOSER_FILE_TRANSFER_MESSAGE =
  "Files cannot be pasted or dropped into the message body. Use Attach files.";
export const COMPOSER_RICH_TRANSFER_LINE_LIMIT_MESSAGE =
  "This text has too many lines for rich text. Switch to plain text mode and paste or drop it again.";

const MAX_RICH_TRANSFER_LINE_BREAKS = MAX_OUTGOING_HTML_NODES - 1;

export const normalizeComposerTransferText = (value: string): string =>
  value.replace(/\r\n?/gu, "\n");

export const composerTransferExceedsRichLineLimit = (
  value: string,
): boolean => {
  let lineBreaks = 0;
  for (const character of value) {
    if (
      character === "\n" &&
      ++lineBreaks > MAX_RICH_TRANSFER_LINE_BREAKS
    ) {
      return true;
    }
  }
  return false;
};

export const composerTransferHasFiles = (
  transfer: DataTransfer | null,
): boolean =>
  Boolean(
    transfer &&
      (transfer.files.length > 0 ||
        Array.from(transfer.items).some((item) => item.kind === "file") ||
        Array.from(transfer.types).includes("Files")),
  );

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const plainTextToComposerHtml = (value: string): string => {
  const normalized = value.replace(/\r\n?/g, "\n");
  if (!normalized) return "";
  return `<p>${normalized
    .split("\n")
    .map(escapeHtml)
    .join("<br>")}</p>`;
};

export const composerHtmlHasFormatting = (value: string): boolean =>
  /<(?:a|b|blockquote|em|h[12]|i|li|ol|s|strong|u|ul)\b/iu.test(value);

export const normalizeComposerLink = (value: string): string | null => {
  const result = canonicalizeOutgoingLink(value);
  return result.status === "valid" ? result.href : null;
};
