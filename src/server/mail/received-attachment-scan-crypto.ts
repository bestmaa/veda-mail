import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { open } from "node:fs/promises";

import { receivedScanError } from "@/server/mail/received-attachment-scan-types";

export const RECEIVED_SCAN_MAGIC = Buffer.from("VMRS1", "ascii");
export const RECEIVED_SCAN_NONCE_BYTES = 8;
export const RECEIVED_SCAN_TAG_BYTES = 16;
export const RECEIVED_SCAN_CHUNK_BYTES = 64 * 1024;
export const RECEIVED_SCAN_HEADER_BYTES =
  RECEIVED_SCAN_MAGIC.byteLength + RECEIVED_SCAN_NONCE_BYTES;

type FileHandle = Awaited<ReturnType<typeof open>>;

const ivFor = (nonce: Uint8Array, index: number): Buffer => {
  const iv = Buffer.alloc(12);
  iv.set(nonce);
  iv.writeUInt32BE(index, RECEIVED_SCAN_NONCE_BYTES);
  return iv;
};

const aadFor = (
  binding: string,
  recordId: string,
  index: number,
  length: number,
): Buffer => Buffer.from(
  `veda-mail/received-scan/v1\0${binding}\0${recordId}\0${index}\0${length}`,
);

export const writeAll = async (
  handle: FileHandle,
  bytes: Uint8Array,
  position: number,
): Promise<number> => {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const result = await handle.write(
      bytes,
      offset,
      bytes.byteLength - offset,
      position + offset,
    );
    if (result.bytesWritten < 1) throw receivedScanError("storage_unavailable");
    offset += result.bytesWritten;
  }
  return position + bytes.byteLength;
};

export const writeScanHeader = async (
  handle: FileHandle,
): Promise<{ readonly nonce: Buffer; readonly position: number }> => {
  const nonce = randomBytes(RECEIVED_SCAN_NONCE_BYTES);
  const position = await writeAll(
    handle,
    Buffer.concat([RECEIVED_SCAN_MAGIC, nonce]),
    0,
  );
  return { nonce, position };
};

export const writeEncryptedScanChunk = async (
  handle: FileHandle,
  input: {
    readonly binding: string;
    readonly bytes: Uint8Array;
    readonly index: number;
    readonly key: Buffer;
    readonly nonce: Uint8Array;
    readonly position: number;
    readonly recordId: string;
  },
): Promise<number> => {
  const cipher = createCipheriv("aes-256-gcm", input.key, ivFor(
    input.nonce,
    input.index,
  ));
  cipher.setAAD(aadFor(
    input.binding,
    input.recordId,
    input.index,
    input.bytes.byteLength,
  ));
  const encrypted = Buffer.concat([
    cipher.update(input.bytes),
    cipher.final(),
  ]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(input.bytes.byteLength);
  return writeAll(
    handle,
    Buffer.concat([length, encrypted, cipher.getAuthTag()]),
    input.position,
  );
};

export const decryptScanChunk = (input: {
  readonly binding: string;
  readonly ciphertext: Uint8Array;
  readonly index: number;
  readonly key: Buffer;
  readonly nonce: Uint8Array;
  readonly plainLength: number;
  readonly recordId: string;
  readonly tag: Uint8Array;
}): Buffer => {
  try {
    const decipher = createDecipheriv("aes-256-gcm", input.key, ivFor(
      input.nonce,
      input.index,
    ));
    decipher.setAAD(aadFor(
      input.binding,
      input.recordId,
      input.index,
      input.plainLength,
    ));
    decipher.setAuthTag(input.tag);
    return Buffer.concat([
      decipher.update(input.ciphertext),
      decipher.final(),
    ]);
  } catch {
    throw receivedScanError("corrupt");
  }
};

export const readExact = async (
  handle: FileHandle,
  length: number,
  position: number,
): Promise<Buffer> => {
  const output = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const result = await handle.read(
      output,
      offset,
      length - offset,
      position + offset,
    );
    if (result.bytesRead < 1) throw receivedScanError("corrupt");
    offset += result.bytesRead;
  }
  return output;
};
