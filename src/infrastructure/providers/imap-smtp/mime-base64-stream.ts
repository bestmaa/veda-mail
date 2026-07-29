import "server-only";

import {
  assertSafeMimeBoundary,
  formatAttachmentContentDisposition,
  normalizeAttachmentMimeType,
} from "@/infrastructure/providers/imap-smtp/mime-attachment-headers";

const MIME_LINE_BYTES = 57;

export type MimeBinarySource = AsyncIterable<Uint8Array> | Iterable<Uint8Array>;

export interface StreamingMimeAttachment {
  readonly boundary: string;
  readonly content: MimeBinarySource;
  readonly contentId?: string;
  readonly contentType?: string | null;
  readonly disposition?: "attachment" | "inline";
  readonly filename: string;
}

const encodeAscii = (value: string): Buffer => Buffer.from(value, "ascii");

const normalizeContentId = (value: string): string => {
  if (/[\r\n]/.test(value)) {
    throw new Error("Content-ID must not contain CR or LF characters.");
  }
  const trimmed = value.trim();
  const startsWrapped = trimmed.startsWith("<");
  const endsWrapped = trimmed.endsWith(">");
  if (startsWrapped !== endsWrapped) {
    throw new Error("Content-ID angle brackets must be balanced.");
  }
  const unwrapped =
    startsWrapped && endsWrapped ? trimmed.slice(1, -1) : trimmed;
  if (
    unwrapped.length < 3 ||
    unwrapped.length > 200 ||
    !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+$/.test(unwrapped)
  ) {
    throw new Error("Content-ID must be a safe addr-spec.");
  }
  return `<${unwrapped}>`;
};

export async function* encodeMimeBase64(
  source: MimeBinarySource,
): AsyncGenerator<Buffer> {
  const line = Buffer.allocUnsafe(MIME_LINE_BYTES);
  let lineLength = 0;
  for await (const chunk of source) {
    if (!(chunk instanceof Uint8Array)) {
      throw new TypeError("MIME binary chunks must be Uint8Array values.");
    }
    let offset = 0;
    while (offset < chunk.byteLength) {
      const length = Math.min(
        MIME_LINE_BYTES - lineLength,
        chunk.byteLength - offset,
      );
      Buffer.from(chunk.buffer, chunk.byteOffset + offset, length).copy(
        line,
        lineLength,
      );
      lineLength += length;
      offset += length;
      if (lineLength === MIME_LINE_BYTES) {
        yield encodeAscii(`${line.toString("base64")}\r\n`);
        lineLength = 0;
      }
    }
  }
  if (lineLength > 0) {
    yield encodeAscii(`${line.subarray(0, lineLength).toString("base64")}\r\n`);
  }
}

export async function* renderMimeAttachmentPart(
  attachment: StreamingMimeAttachment,
): AsyncGenerator<Buffer> {
  const boundary = assertSafeMimeBoundary(attachment.boundary);
  const contentType = normalizeAttachmentMimeType(attachment.contentType);
  const disposition = formatAttachmentContentDisposition(
    attachment.filename,
    attachment.disposition,
  );
  const contentId = attachment.contentId
    ? `Content-ID: ${normalizeContentId(attachment.contentId)}\r\n`
    : "";
  yield encodeAscii(
    `--${boundary}\r\n` +
      `Content-Type: ${contentType}\r\n` +
      "Content-Transfer-Encoding: base64\r\n" +
      `Content-Disposition: ${disposition}\r\n` +
      contentId +
      "\r\n",
  );
  yield* encodeMimeBase64(attachment.content);
}

export const renderMimeClosingBoundary = (boundary: string): Buffer =>
  encodeAscii(`--${assertSafeMimeBoundary(boundary)}--\r\n`);
