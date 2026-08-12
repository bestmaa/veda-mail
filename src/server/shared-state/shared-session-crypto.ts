import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from "node:crypto";

import { z } from "zod";

import { scheduledJobRootKey } from "@/server/scheduled-send/scheduled-send-key";

export type SharedSessionKind = "administrator" | "member";

const envelopeSchema = z.object({
  algorithm: z.literal("aes-256-gcm"),
  ciphertext: z.string().regex(/^[A-Za-z0-9_-]{1,349526}$/u),
  iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/u),
  tag: z.string().regex(/^[A-Za-z0-9_-]{22}$/u),
  version: z.literal(1),
}).strict();

const subkey = (context: string): Buffer => Buffer.from(hkdfSync(
  "sha256",
  scheduledJobRootKey(),
  Buffer.alloc(0),
  `veda-mail/shared-session/${context}/v1`,
  32,
));

export const sharedSessionOpaqueId = (
  kind: SharedSessionKind,
  id: string,
): string => createHmac("sha256", subkey("record-index"))
  .update(kind).update("\0").update(id).digest("base64url");

export const sharedSessionOwnerIndex = (ownerKey: string): string =>
  createHmac("sha256", subkey("owner-index"))
    .update(ownerKey).digest("base64url");

const aad = (kind: SharedSessionKind, opaqueId: string): Buffer =>
  Buffer.from(`veda-mail/shared-session/payload/v1\0${kind}\0${opaqueId}`, "utf8");

export const encryptSharedSession = (
  kind: SharedSessionKind,
  opaqueId: string,
  value: unknown,
): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", subkey("payload-encryption"), iv);
  cipher.setAAD(aad(kind, opaqueId));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  if (ciphertext.byteLength > 256 * 1_024) {
    throw new RangeError("Shared session record exceeds 256 KiB.");
  }
  return JSON.stringify({
    algorithm: "aes-256-gcm",
    ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    version: 1,
  });
};

export const decryptSharedSession = <T>(
  kind: SharedSessionKind,
  opaqueId: string,
  serialized: string,
  schema: z.ZodType<T>,
): T => {
  if (Buffer.byteLength(serialized, "utf8") > 350 * 1_024) {
    throw new RangeError("Shared session envelope exceeds 350 KiB.");
  }
  const envelope = envelopeSchema.parse(JSON.parse(serialized));
  const decipher = createDecipheriv(
    "aes-256-gcm",
    subkey("payload-encryption"),
    Buffer.from(envelope.iv, "base64url"),
  );
  decipher.setAAD(aad(kind, opaqueId));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  return schema.parse(JSON.parse(plaintext));
};
