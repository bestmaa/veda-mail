import "server-only";

import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { id, type AttachmentId } from "@/domain/shared/brand";

const state = globalThis as typeof globalThis & {
  __vedaMailReceivedAttachmentIdentityKey?: Buffer;
};

const identityKey = (): Buffer => {
  state.__vedaMailReceivedAttachmentIdentityKey ??= randomBytes(32);
  return state.__vedaMailReceivedAttachmentIdentityKey;
};

const addPart = (
  hmac: ReturnType<typeof createHmac>,
  value: string | number | null,
): void => {
  const encoded = Buffer.from(String(value ?? ""), "utf8");
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(encoded.byteLength);
  hmac.update(length).update(encoded);
};

export const createOpaqueReceivedAttachmentId = (
  provider: "imap-smtp" | "stalwart-jmap",
  parts: readonly (string | number | null)[],
): AttachmentId => {
  const hmac = createHmac("sha256", identityKey());
  addPart(hmac, "veda-mail/received-attachment/v1");
  addPart(hmac, provider);
  for (const part of parts) addPart(hmac, part);
  return id.attachment(`message-attachment-${hmac.digest("base64url")}`);
};

export const attachmentIdsEqual = (
  left: string,
  right: string,
): boolean => {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return (
    leftBytes.byteLength === rightBytes.byteLength &&
    timingSafeEqual(leftBytes, rightBytes)
  );
};
