import "server-only";

import type { open } from "node:fs/promises";
import path from "node:path";

export const ATTACHMENT_CRYPTO_MAGIC = Buffer.from("VMAT1", "ascii");
export const ATTACHMENT_CRYPTO_IV_BYTES = 12;
export const ATTACHMENT_CRYPTO_TAG_BYTES = 16;

const FINAL_NAME_PATTERN = /^attachment-[A-Za-z0-9_-]{32}\.vma$/;

export const attachmentCryptoAad = (
  attachmentId: string,
  expectedBytes: number,
): Buffer =>
  Buffer.from(`veda-mail-attachment\0${attachmentId}\0${expectedBytes}`);

export const attachmentCryptoFinalName = (attachmentId: string): string =>
  `attachment-${attachmentId}.vma`;

export const safeAttachmentCryptoPath = (
  directory: string,
  name: string,
): string => {
  if (!FINAL_NAME_PATTERN.test(name)) {
    throw new Error("Unsafe encrypted attachment reference.");
  }
  return path.join(directory, name);
};

export const writeAttachmentCryptoBuffer = async (
  handle: Awaited<ReturnType<typeof open>>,
  contents: Uint8Array,
  start: number,
): Promise<number> => {
  let offset = 0;
  while (offset < contents.byteLength) {
    const { bytesWritten } = await handle.write(
      contents,
      offset,
      contents.byteLength - offset,
      start + offset,
    );
    if (bytesWritten < 1) {
      throw new Error("Encrypted attachment write made no progress.");
    }
    offset += bytesWritten;
  }
  return start + contents.byteLength;
};
