import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type {
  AttachmentQuotas,
  AttachmentScope,
} from "@/server/attachments/attachment-types";
import {
  AttachmentQuarantineError,
  defaultAttachmentQuotas,
} from "@/server/attachments/attachment-types";

const ATTACHMENT_ID_PATTERN = /^[A-Za-z0-9_-]{32}$/;
const MIME_TYPE_PATTERN =
  /^[a-z0-9][a-z0-9!#$&^_.+-]{0,62}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,62}$/;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const UNSAFE_FILENAME_CHARACTERS = new Set('/\\:<>"|?*');
const MAX_FILENAME_BYTES = 180;
const MAX_SCOPE_PART_BYTES = 256;
const KEY_BYTES = 32;

const globalKeyState = globalThis as typeof globalThis & {
  __vedaMailAttachmentProcessKey?: Buffer;
};

export interface ScopeBindings {
  readonly access: string;
  readonly draft: string;
  readonly session: string;
}

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
    if (Buffer.byteLength(output + character) > maximumBytes) {
      break;
    }
    output += character;
  }
  return output;
};

export const sanitizeAttachmentFileName = (input: string): string => {
  if (typeof input !== "string" || Buffer.byteLength(input) > 4096) {
    throw new AttachmentQuarantineError(
      "Attachment filename is invalid.",
      "INVALID_ATTACHMENT_NAME",
      400,
    );
  }
  let safe = [...input.normalize("NFKC")]
    .map((character) =>
      isUnsafeFilenameCharacter(character) ? "_" : character,
    )
    .join("")
    .replace(/\s+/gu, " ")
    .replace(/_+/gu, "_")
    .replace(/^[ .]+|[ .]+$/gu, "");
  safe = truncateUtf8(safe, MAX_FILENAME_BYTES).replace(/[ .]+$/gu, "");
  if (!safe || /^[_ .-]+$/u.test(safe)) {
    safe = "attachment";
  }
  if (safe.startsWith(".")) {
    safe = `attachment${safe}`;
  }
  if (WINDOWS_RESERVED_NAME.test(safe)) {
    safe = `attachment-${safe}`;
  }
  return safe;
};

export const normalizeAttachmentMimeType = (input: string): string => {
  if (typeof input !== "string" || input.length > 256) {
    throw new AttachmentQuarantineError(
      "Attachment media type is invalid.",
      "INVALID_ATTACHMENT_MIME_TYPE",
      400,
    );
  }
  const mimeType = input.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!MIME_TYPE_PATTERN.test(mimeType)) {
    throw new AttachmentQuarantineError(
      "Attachment media type is invalid.",
      "INVALID_ATTACHMENT_MIME_TYPE",
      400,
    );
  }
  return mimeType;
};

export const parseAttachmentContentLength = (value: string | null): number => {
  if (value === null || !/^(?:0|[1-9]\d{0,15})$/.test(value)) {
    throw new AttachmentQuarantineError(
      "A valid Content-Length header is required.",
      "INVALID_ATTACHMENT_CONTENT_LENGTH",
      400,
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new AttachmentQuarantineError(
      "A valid Content-Length header is required.",
      "INVALID_ATTACHMENT_CONTENT_LENGTH",
      400,
    );
  }
  return parsed;
};

export const createAttachmentId = (): string =>
  randomBytes(24).toString("base64url");

export const assertAttachmentId = (value: string): void => {
  if (!ATTACHMENT_ID_PATTERN.test(value)) {
    throw notFoundError();
  }
};

const decodeEnvironmentKey = (encoded: string): Buffer => {
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(encoded)) {
    throw new Error("VEDA_MAIL_ATTACHMENT_KEY must be a base64 32-byte key.");
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error("VEDA_MAIL_ATTACHMENT_KEY must be a base64 32-byte key.");
  }
  return key;
};

export const resolveAttachmentEncryptionKey = (
  injected?: Uint8Array,
): Buffer => {
  if (injected !== undefined) {
    if (injected.byteLength !== KEY_BYTES) {
      throw new RangeError("Attachment encryption key must be 32 bytes.");
    }
    return Buffer.from(injected);
  }
  const configured = process.env["VEDA_MAIL_ATTACHMENT_KEY"];
  if (configured) {
    return decodeEnvironmentKey(configured);
  }
  globalKeyState.__vedaMailAttachmentProcessKey ??= randomBytes(KEY_BYTES);
  return Buffer.from(globalKeyState.__vedaMailAttachmentProcessKey);
};

const assertScopePart = (value: string): void => {
  const bytes = typeof value === "string" ? Buffer.byteLength(value) : 0;
  const hasControlCharacter =
    typeof value === "string" &&
    [...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
    });
  if (bytes < 1 || bytes > MAX_SCOPE_PART_BYTES || hasControlCharacter) {
    throw new AttachmentQuarantineError(
      "Attachment scope is invalid.",
      "INVALID_ATTACHMENT_SCOPE",
      400,
    );
  }
};

const binding = (key: Buffer, label: string, parts: string[]): string => {
  const hmac = createHmac("sha256", key).update(label);
  for (const part of parts) {
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(Buffer.byteLength(part));
    hmac.update(length).update(part);
  }
  return hmac.digest("hex");
};

export const deriveScopeBindings = (
  key: Buffer,
  scope: AttachmentScope,
): ScopeBindings => {
  const parts = [
    scope.ownerId,
    scope.connectionId,
    scope.sessionId,
    scope.draftId,
  ];
  parts.forEach(assertScopePart);
  return {
    access: binding(key, "access", parts),
    draft: binding(key, "draft", parts),
    session: binding(key, "session", parts.slice(0, 3)),
  };
};

export const bindingsEqual = (left: string, right: string): boolean =>
  timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));

export const resolveAttachmentQuotas = (
  input: Partial<AttachmentQuotas> = {},
): AttachmentQuotas => {
  const quotas = { ...defaultAttachmentQuotas, ...input };
  for (const value of Object.values(quotas)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError("Attachment quotas must be positive safe integers.");
    }
  }
  if (
    quotas.maxFileBytes > quotas.maxAggregateBytesPerDraft ||
    quotas.maxAggregateBytesPerDraft > quotas.maxBytesPerSession ||
    quotas.maxBytesPerSession > quotas.maxGlobalBytes ||
    quotas.maxFilesPerDraft > quotas.maxGlobalRecords
  ) {
    throw new RangeError("Attachment byte quotas are inconsistent.");
  }
  return quotas;
};

export const notFoundError = (): AttachmentQuarantineError =>
  new AttachmentQuarantineError(
    "Attachment was not found.",
    "ATTACHMENT_NOT_FOUND",
    404,
  );
