import type { ReceivedAttachmentDisposition } from "@/domain/mail/mail";

const DEFAULT_ATTACHMENT_NAME = "attachment.bin";
const MAX_ATTACHMENT_NAME_BYTES = 180;
const MAX_CONTENT_ID_BYTES = 998;
const MAX_CONTENT_ID_INPUT_CODE_UNITS = 4_096;
export const MAX_RECEIVED_ATTACHMENT_DOWNLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_RECEIVED_ATTACHMENT_TEXT_PREVIEW_BYTES = 1 * 1024 * 1024;
const MIME_TYPE =
  /^[a-z0-9][a-z0-9!#$&^_.+-]{0,62}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,62}$/u;
const WINDOWS_RESERVED_NAME =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const UNSAFE_FILENAME_CHARACTERS = new Set('/\\:<>"|?*');

const utf8Length = (value: string): number =>
  new TextEncoder().encode(value).byteLength;

const isUnsafeContentIdCharacter = (character: string): boolean => {
  const codePoint = character.codePointAt(0) ?? 0;
  return (
    codePoint <= 0x1f ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
    /\s/u.test(character) ||
    character === "<" ||
    character === ">"
  );
};

const isUnsafeFilenameCharacter = (character: string): boolean => {
  const codePoint = character.codePointAt(0) ?? 0;
  return (
    codePoint <= 0x1f ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069) ||
    UNSAFE_FILENAME_CHARACTERS.has(character)
  );
};

const truncateUtf8 = (value: string, maximumBytes: number): string => {
  let output = "";
  for (const character of value) {
    if (utf8Length(output + character) > maximumBytes) break;
    output += character;
  }
  return output;
};

const truncateFilename = (value: string): string => {
  if (utf8Length(value) <= MAX_ATTACHMENT_NAME_BYTES) return value;
  const extension = value.match(/(\.[^./]{1,24})$/u)?.[1] ?? "";
  const extensionBytes = utf8Length(extension);
  if (!extension || extensionBytes >= MAX_ATTACHMENT_NAME_BYTES / 2) {
    return truncateUtf8(value, MAX_ATTACHMENT_NAME_BYTES);
  }
  return `${truncateUtf8(
    value.slice(0, -extension.length),
    MAX_ATTACHMENT_NAME_BYTES - extensionBytes,
  )}${extension}`;
};

export const sanitizeReceivedAttachmentName = (input: unknown): string => {
  const source =
    typeof input === "string" && utf8Length(input) <= 4_096
      ? input.toWellFormed().normalize("NFKC")
      : DEFAULT_ATTACHMENT_NAME;
  let safe = [...source]
    .map((character) =>
      isUnsafeFilenameCharacter(character) ? "_" : character,
    )
    .join("")
    .replace(/\s+/gu, " ")
    .replace(/_+/gu, "_")
    .replace(/^[ .]+|[ .]+$/gu, "");
  safe = truncateFilename(safe).replace(/[ .]+$/gu, "");
  if (!safe || /^[_ .-]+$/u.test(safe)) safe = DEFAULT_ATTACHMENT_NAME;
  if (safe.startsWith(".")) safe = `attachment${safe}`;
  if (WINDOWS_RESERVED_NAME.test(safe)) safe = `attachment-${safe}`;
  return safe;
};

export const normalizeReceivedAttachmentMimeType = (
  input: unknown,
): string => {
  if (typeof input !== "string" || input.length > 256) {
    return "application/octet-stream";
  }
  const value = input.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return MIME_TYPE.test(value) ? value : "application/octet-stream";
};

export const normalizeReceivedAttachmentDisposition = (
  input: unknown,
  fallback: ReceivedAttachmentDisposition = "attachment",
): ReceivedAttachmentDisposition => {
  if (typeof input !== "string" || input.length > 256) return fallback;
  const value = input.trim().toLowerCase();
  return value === "attachment" || value === "inline" ? value : fallback;
};

export const normalizeContentId = (value: string): string | null => {
  if (
    value.length === 0 ||
    value.length > MAX_CONTENT_ID_INPUT_CODE_UNITS
  ) {
    return null;
  }

  if (utf8Length(value) > MAX_CONTENT_ID_BYTES) return null;

  const startsWithBracket = value.startsWith("<");
  const endsWithBracket = value.endsWith(">");
  if (startsWithBracket !== endsWithBracket) return null;
  const normalized = startsWithBracket ? value.slice(1, -1) : value;

  if (
    normalized.length === 0 ||
    utf8Length(normalized) > MAX_CONTENT_ID_BYTES ||
    [...normalized].some(isUnsafeContentIdCharacter)
  ) {
    return null;
  }
  return normalized;
};

export const normalizeCidUrlContentId = (value: string): string | null => {
  if (
    value.length === 0 ||
    value.length > MAX_CONTENT_ID_INPUT_CODE_UNITS
  ) {
    return null;
  }
  try {
    return normalizeContentId(decodeURIComponent(value));
  } catch {
    return null;
  }
};
