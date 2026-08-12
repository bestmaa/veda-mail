import "server-only";

import { createDecipheriv } from "node:crypto";

import {
  attachmentCryptoAad,
  ATTACHMENT_CRYPTO_IV_BYTES,
  ATTACHMENT_CRYPTO_MAGIC,
  ATTACHMENT_CRYPTO_TAG_BYTES,
} from "@/server/attachments/attachment-crypto-format";
import { assertAttachmentId } from
  "@/server/attachments/attachment-security";

export const decryptEncryptedAttachment = (
  contents: Buffer,
  attachmentId: string,
  expectedBytes: number,
  key: Buffer,
): Buffer => {
  assertAttachmentId(attachmentId);
  const headerBytes =
    ATTACHMENT_CRYPTO_MAGIC.byteLength + ATTACHMENT_CRYPTO_IV_BYTES;
  if (
    contents.byteLength !==
      headerBytes + expectedBytes + ATTACHMENT_CRYPTO_TAG_BYTES ||
    !contents.subarray(0, ATTACHMENT_CRYPTO_MAGIC.byteLength)
      .equals(ATTACHMENT_CRYPTO_MAGIC)
  ) throw new Error("Encrypted attachment is corrupt.");
  const iv = contents.subarray(ATTACHMENT_CRYPTO_MAGIC.byteLength, headerBytes);
  const encrypted = contents.subarray(headerBytes, -ATTACHMENT_CRYPTO_TAG_BYTES);
  const tag = contents.subarray(-ATTACHMENT_CRYPTO_TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(attachmentCryptoAad(attachmentId, expectedBytes));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
};
