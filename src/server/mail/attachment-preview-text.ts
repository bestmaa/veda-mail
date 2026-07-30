import "server-only";

import type {
  AttachmentMimeDetector,
  AttachmentScanner,
} from "@/server/attachments";
import { waitForAttachmentImport } from "@/server/mail/attachment-import-operation";
import { ApiError } from "@/transport/http/api-error";

const SAMPLE_BYTES = 8_192;
const SCAN_CHUNK_BYTES = 64 * 1_024;
const MAX_TEXT_CODE_POINTS = 100_000;
const MAX_TEXT_LINES = 10_000;

const isUnsafeTextCharacter = (character: string): boolean => {
  const codePoint = character.codePointAt(0) ?? 0;
  return (
    codePoint <= 0x08 ||
    codePoint === 0x0b ||
    codePoint === 0x0c ||
    (codePoint >= 0x0e && codePoint <= 0x1f) ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    codePoint === 0x061c ||
    codePoint === 0x200e ||
    codePoint === 0x200f ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069) ||
    codePoint === 0xfeff
  );
};

const unsupported = (): ApiError =>
  new ApiError(
    "This attachment type cannot be safely previewed.",
    "ATTACHMENT_PREVIEW_UNSUPPORTED",
    415,
  );

const blocked = (): ApiError =>
  new ApiError(
    "This attachment was blocked from preview.",
    "ATTACHMENT_PREVIEW_BLOCKED",
    422,
  );

const scannerUnavailable = (): ApiError =>
  new ApiError(
    "The attachment security scanner is unavailable.",
    "ATTACHMENT_PREVIEW_SCANNER_UNAVAILABLE",
    503,
  );

const inspectEveryByte = async (
  bytes: Uint8Array,
  scanner: AttachmentScanner,
  signal: AbortSignal,
): Promise<void> => {
  let inspected = 0;
  const content = async function* (): AsyncGenerator<Uint8Array> {
    for (let offset = 0; offset < bytes.byteLength; offset += SCAN_CHUNK_BYTES) {
      const chunk = bytes.subarray(
        offset,
        Math.min(bytes.byteLength, offset + SCAN_CHUNK_BYTES),
      );
      inspected += chunk.byteLength;
      yield chunk;
    }
  };
  let verdict: unknown;
  try {
    if (signal.aborted) throw scannerUnavailable();
    verdict = await waitForAttachmentImport(
      scanner.scan(content(), {
        abortUpload: () => undefined,
        attachmentId: `preview-${crypto.randomUUID()}`,
        expectedBytes: bytes.byteLength,
        signal,
      }),
      signal,
    );
  } catch {
    throw scannerUnavailable();
  }
  if (
    inspected !== bytes.byteLength ||
    !verdict ||
    typeof verdict !== "object" ||
    !("verdict" in verdict) ||
    !["clean", "infected"].includes(String(verdict.verdict))
  ) {
    throw scannerUnavailable();
  }
  if (verdict.verdict !== "clean") throw blocked();
};

const assertPlainText = async (
  bytes: Uint8Array,
  declaredMimeType: string,
  fileName: string,
  detector: AttachmentMimeDetector,
  signal: AbortSignal,
): Promise<void> => {
  if (declaredMimeType !== "text/plain" || bytes.byteLength === 0) {
    throw unsupported();
  }
  let detected: unknown;
  try {
    if (signal.aborted) throw unsupported();
    detected = await waitForAttachmentImport(
      detector.detect({
        byteLength: bytes.byteLength,
        declaredMimeType,
        fileName,
        sample: bytes.subarray(0, SAMPLE_BYTES),
      }),
      signal,
    );
  } catch {
    throw new ApiError(
      "Attachment type detection is unavailable.",
      "ATTACHMENT_PREVIEW_MIME_UNAVAILABLE",
      503,
    );
  }
  if (
    !detected ||
    typeof detected !== "object" ||
    !("verdict" in detected) ||
    !("mimeType" in detected) ||
    detected.verdict !== "accepted" ||
    detected.mimeType !== "text/plain"
  ) {
    throw unsupported();
  }
};

const decodeSafeText = (bytes: Uint8Array): string => {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw unsupported();
  }
  text = text.replace(/\r\n?|\u2028|\u2029/gu, "\n");
  let codePoints = 0;
  let lines = 1;
  for (const character of text) {
    if (isUnsafeTextCharacter(character)) throw blocked();
    codePoints += 1;
    if (character === "\n") lines += 1;
    if (codePoints > MAX_TEXT_CODE_POINTS || lines > MAX_TEXT_LINES) {
      throw new ApiError(
        "This text attachment is too large to preview safely.",
        "ATTACHMENT_PREVIEW_TOO_LARGE",
        413,
      );
    }
  }
  return text;
};

export const inspectTextAttachmentPreview = async (
  input: {
    readonly bytes: Uint8Array;
    readonly declaredMimeType: string;
    readonly fileName: string;
    readonly signal: AbortSignal;
  },
  dependencies: {
    readonly mimeDetector: AttachmentMimeDetector;
    readonly scanner: AttachmentScanner;
  },
): Promise<Uint8Array> => {
  await inspectEveryByte(input.bytes, dependencies.scanner, input.signal);
  await assertPlainText(
    input.bytes,
    input.declaredMimeType,
    input.fileName,
    dependencies.mimeDetector,
    input.signal,
  );
  return new TextEncoder().encode(decodeSafeText(input.bytes));
};
