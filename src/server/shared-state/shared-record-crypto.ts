import "server-only";

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

import { z } from "zod";

import { scheduledJobRootKey } from
  "@/server/scheduled-send/scheduled-send-key";
import type { SharedRecordKind } from
  "@/server/shared-state/shared-record-repository";

const envelopeSchema = z.object({
  algorithm: z.literal("aes-256-gcm"),
  ciphertext: z.string().min(1).max(2_796_203).regex(/^[A-Za-z0-9_-]+$/u),
  iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/u),
  tag: z.string().regex(/^[A-Za-z0-9_-]{22}$/u),
  version: z.literal(1),
}).strict();

const key = (kind: SharedRecordKind): Buffer => Buffer.from(hkdfSync(
  "sha256",
  scheduledJobRootKey(),
  Buffer.alloc(0),
  `veda-mail/shared-record/${kind}/encryption/v1`,
  32,
));
const aad = (kind: SharedRecordKind): Buffer =>
  Buffer.from(`veda-mail/shared-record/${kind}/payload/v1`, "utf8");

export const encryptSharedRecord = (
  kind: SharedRecordKind,
  value: unknown,
): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(kind), iv);
  cipher.setAAD(aad(kind));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"), cipher.final(),
  ]);
  const maxBytes = kind === "mail-user-idempotency"
    ? 2 * 1_024 * 1_024
    : 32 * 1_024;
  if (ciphertext.byteLength > maxBytes) {
    throw new RangeError("Shared singleton record exceeds its safe size limit.");
  }
  return JSON.stringify({
    algorithm: "aes-256-gcm",
    ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    version: 1,
  });
};

export const decryptSharedRecord = <T>(
  kind: SharedRecordKind,
  serialized: string,
  schema: z.ZodType<T>,
): T => {
  const envelope = envelopeSchema.parse(JSON.parse(serialized));
  const decipher = createDecipheriv(
    "aes-256-gcm", key(kind), Buffer.from(envelope.iv, "base64url"),
  );
  decipher.setAAD(aad(kind));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  return schema.parse(JSON.parse(plaintext));
};
