import "server-only";

import { createCipheriv, createDecipheriv, createHmac, hkdfSync,
  randomBytes } from "node:crypto";

import { z } from "zod";

import { scheduledJobRootKey } from "@/server/scheduled-send/scheduled-send-key";
import { id } from "@/domain/shared/brand";
import type { SendReceipt } from "@/domain/mail/mail";

const receiptSchema = z.object({
  deliveryNoticeId: z.string().uuid().optional(),
  deliveryStatus: z.enum(["accepted", "partial", "uncertain"]),
  id: z.string().min(1).max(2_048).transform(id.message),
  rejectedRecipients: z.array(z.string().min(1).max(998)).max(1_000),
  submittedAt: z.string().datetime(),
}).strict().transform((value): SendReceipt => ({
  deliveryStatus: value.deliveryStatus,
  id: value.id,
  rejectedRecipients: [...value.rejectedRecipients],
  submittedAt: value.submittedAt,
  ...(value.deliveryNoticeId ? { deliveryNoticeId: value.deliveryNoticeId } : {}),
}));
const common = {
  bytes: z.number().int().positive().max(512 * 1_024),
  draftId: z.string().min(1).max(200),
  expiresAt: z.number().int().positive(),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
};
const entrySchema = z.discriminatedUnion("state", [
  z.object({ ...common, connectionExpiresAt: z.number().int().positive(),
    state: z.literal("pending"), token: z.string().uuid() }).strict(),
  z.object({ ...common, receipt: receiptSchema, state: z.literal("completed") }).strict(),
]);
export const sharedSendBucketSchema = z.object({
  entries: z.array(entrySchema).max(900), version: z.literal(1),
}).strict();
export type SharedSendBucket = z.infer<typeof sharedSendBucketSchema>;

const envelopeSchema = z.object({ algorithm: z.literal("aes-256-gcm"),
  ciphertext: z.string().min(1).max(64 * 1_024 * 1_024),
  iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/u),
  tag: z.string().regex(/^[A-Za-z0-9_-]{22}$/u), version: z.literal(1) }).strict();
const subkey = (context: string): Buffer => Buffer.from(hkdfSync("sha256",
  scheduledJobRootKey(), Buffer.alloc(0),
  `veda-mail/shared-send-idempotency/${context}/v1`, 32));
export const sharedSendConnectionKey = (connectionId: string): string =>
  createHmac("sha256", subkey("connection-index")).update(connectionId).digest("base64url");
const aad = (key: string) => Buffer.from(
  `veda-mail/shared-send-idempotency/payload/v1\0${key}`, "utf8");

export const encryptSharedSendBucket = (key: string, value: SharedSendBucket): string => {
  const canonical = sharedSendBucketSchema.parse(value);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", subkey("payload-encryption"), iv);
  cipher.setAAD(aad(key));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(canonical), "utf8"), cipher.final(),
  ]);
  return JSON.stringify({ algorithm: "aes-256-gcm",
    ciphertext: ciphertext.toString("base64url"), iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"), version: 1 });
};
export const decryptSharedSendBucket = (key: string, serialized: string): SharedSendBucket => {
  const envelope = envelopeSchema.parse(JSON.parse(serialized));
  const decipher = createDecipheriv("aes-256-gcm", subkey("payload-encryption"),
    Buffer.from(envelope.iv, "base64url"));
  decipher.setAAD(aad(key));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64url")), decipher.final(),
  ]).toString("utf8");
  return sharedSendBucketSchema.parse(JSON.parse(plaintext));
};
