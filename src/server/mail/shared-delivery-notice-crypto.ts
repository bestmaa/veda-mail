import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from "node:crypto";

import { z } from "zod";

import type { DeliveryNoticeBucket } from
  "@/server/mail/delivery-notice-budget";
import { DELIVERY_NOTICE_OVERFLOW_MESSAGE } from
  "@/server/mail/delivery-notice-record";
import { scheduledJobRootKey } from
  "@/server/scheduled-send/scheduled-send-key";

const base = {
  deliveryNoticeId: z.string().uuid(),
  submittedAt: z.string().datetime(),
};
const noticeSchema = z.discriminatedUnion("kind", [
  z.object({
    ...base,
    kind: z.literal("partial"),
    rejectedRecipients: z.array(z.string().min(1).max(254)).min(1).max(100),
  }).strict(),
  z.object({ ...base, kind: z.literal("uncertain") }).strict(),
  z.object({
    ...base,
    kind: z.literal("overflow"),
    message: z.literal(DELIVERY_NOTICE_OVERFLOW_MESSAGE),
  }).strict(),
]);
export const sharedDeliveryNoticeBucketSchema = z.object({
  expiresAt: z.number().int().positive(),
  notices: z.array(noticeSchema).max(100),
  sequence: z.number().int().nonnegative(),
  version: z.literal(1),
}).strict().transform((value): DeliveryNoticeBucket & { readonly version: 1 } => ({
  ...value,
  notices: value.notices.map((notice) => notice.kind === "partial"
    ? { ...notice, rejectedRecipients: [...notice.rejectedRecipients] }
    : { ...notice }),
}));
export type SharedDeliveryNoticeBucket = z.infer<
  typeof sharedDeliveryNoticeBucketSchema
>;

const envelopeSchema = z.object({
  algorithm: z.literal("aes-256-gcm"),
  ciphertext: z.string().min(1).max(16 * 1024 * 1024),
  iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/u),
  tag: z.string().regex(/^[A-Za-z0-9_-]{22}$/u),
  version: z.literal(1),
}).strict();
const subkey = (context: string): Buffer => Buffer.from(hkdfSync(
  "sha256",
  scheduledJobRootKey(),
  Buffer.alloc(0),
  `veda-mail/shared-delivery-notice/${context}/v1`,
  32,
));
export const sharedDeliveryNoticeConnectionKey = (
  connectionId: string,
): string => createHmac("sha256", subkey("connection-index"))
  .update(connectionId)
  .digest("base64url");
const aad = (connectionKey: string): Buffer => Buffer.from(
  `veda-mail/shared-delivery-notice/payload/v1\0${connectionKey}`,
  "utf8",
);

export const encryptSharedDeliveryNoticeBucket = (
  connectionKey: string,
  value: SharedDeliveryNoticeBucket,
): string => {
  const canonical = sharedDeliveryNoticeBucketSchema.parse(value);
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    subkey("payload-encryption"),
    iv,
  );
  cipher.setAAD(aad(connectionKey));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(canonical), "utf8"),
    cipher.final(),
  ]);
  return JSON.stringify({
    algorithm: "aes-256-gcm",
    ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    version: 1,
  });
};

export const decryptSharedDeliveryNoticeBucket = (
  connectionKey: string,
  serialized: string,
): SharedDeliveryNoticeBucket => {
  const envelope = envelopeSchema.parse(JSON.parse(serialized));
  const decipher = createDecipheriv(
    "aes-256-gcm",
    subkey("payload-encryption"),
    Buffer.from(envelope.iv, "base64url"),
  );
  decipher.setAAD(aad(connectionKey));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  return sharedDeliveryNoticeBucketSchema.parse(JSON.parse(plaintext));
};
