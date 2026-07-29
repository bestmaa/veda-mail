import "server-only";

import { randomBytes } from "node:crypto";

const DEFAULT_FILENAME = "attachment.bin";
const MAX_FILENAME_BYTES = 180;
const MIME_TOKEN = /^[a-z0-9!#$%&'*+.^_`{|}~-]+$/;
const SAFE_BOUNDARY = /^[A-Za-z0-9'()+_,./:=?-]{1,70}$/;

export type MimeRandomSource = (size: number) => Uint8Array;

const rejectHeaderInjection = (value: string, label: string): void => {
  if (/[\r\n]/.test(value)) {
    throw new Error(`${label} must not contain CR or LF characters.`);
  }
};

const utf8Length = (value: string): number => Buffer.byteLength(value, "utf8");

const truncateUtf8 = (value: string, maximumBytes: number): string => {
  let result = "";
  let used = 0;
  for (const character of value) {
    const bytes = utf8Length(character);
    if (used + bytes > maximumBytes) break;
    result += character;
    used += bytes;
  }
  return result;
};

const truncateFilename = (value: string): string => {
  if (utf8Length(value) <= MAX_FILENAME_BYTES) return value;
  const extension = value.match(/(\.[^./]{1,24})$/u)?.[1] ?? "";
  const extensionBytes = utf8Length(extension);
  if (!extension || extensionBytes >= MAX_FILENAME_BYTES / 2) {
    return truncateUtf8(value, MAX_FILENAME_BYTES);
  }
  const basename = value.slice(0, -extension.length);
  return `${truncateUtf8(
    basename,
    MAX_FILENAME_BYTES - extensionBytes,
  )}${extension}`;
};

const asciiFallback = (value: string): string => {
  let fallback = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    fallback += codePoint >= 0x20 && codePoint <= 0x7e ? character : "_";
  }
  return fallback || DEFAULT_FILENAME;
};

const replaceControlCharacters = (value: string): string => {
  let result = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    result += codePoint < 0x20 || codePoint === 0x7f ? "_" : character;
  }
  return result;
};

const quoteMimeParameter = (value: string): string =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

const encodeExtendedParameter = (value: string): string =>
  encodeURIComponent(value).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

export const normalizeAttachmentFilename = (value: string): string => {
  rejectHeaderInjection(value, "Attachment filename");
  const normalized = value
    .toWellFormed()
    .normalize("NFC")
    .trim()
    .replaceAll("/", "_")
    .replaceAll("\\", "_");
  const withoutControls = replaceControlCharacters(normalized);
  return truncateFilename(withoutControls || DEFAULT_FILENAME);
};

export const formatAttachmentContentDisposition = (
  filename: string,
  disposition: "attachment" | "inline" = "attachment",
): string => {
  if (disposition !== "attachment" && disposition !== "inline") {
    throw new Error("MIME disposition must be attachment or inline.");
  }
  const normalized = normalizeAttachmentFilename(filename);
  return `${disposition}; filename=${quoteMimeParameter(
    asciiFallback(normalized),
  )}; filename*=UTF-8''${encodeExtendedParameter(normalized)}`;
};

export const normalizeAttachmentMimeType = (
  value: string | null | undefined,
): string => {
  if (!value) return "application/octet-stream";
  rejectHeaderInjection(value, "MIME type");
  const [untrimmedType = ""] = value.split(";", 1);
  if (untrimmedType.length > 127) {
    return "application/octet-stream";
  }
  const [major = "", minor = "", extra = ""] = untrimmedType
    .trim()
    .toLowerCase()
    .split("/");
  if (
    extra ||
    !major ||
    !minor ||
    !MIME_TOKEN.test(major) ||
    !MIME_TOKEN.test(minor)
  ) {
    return "application/octet-stream";
  }
  return `${major}/${minor}`;
};

export const assertSafeMimeBoundary = (value: string): string => {
  rejectHeaderInjection(value, "MIME boundary");
  if (!SAFE_BOUNDARY.test(value)) {
    throw new Error("MIME boundary contains unsupported characters.");
  }
  return value;
};

export const createMimeBoundary = (
  randomSource: MimeRandomSource = randomBytes,
): string => {
  const entropy = randomSource(24);
  if (entropy.byteLength !== 24) {
    throw new Error("MIME boundary entropy source must return 24 bytes.");
  }
  return assertSafeMimeBoundary(`veda_${Buffer.from(entropy).toString("hex")}`);
};
