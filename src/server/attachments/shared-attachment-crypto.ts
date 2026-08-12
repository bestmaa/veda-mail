import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

import { z } from "zod";

import type { StoredAttachment } from
  "@/server/attachments/attachment-record";

const bindingSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const recordSchema = z.object({
  bindings: z.object({
    access: bindingSchema,
    draft: bindingSchema,
    session: bindingSchema,
  }).strict(),
  contentLength: z.number().int().positive().safe(),
  createdAt: z.number().int().nonnegative().safe(),
  declaredMimeType: z.string().min(3).max(127),
  detectedMimeType: z.string().min(3).max(127).optional(),
  encryptedFile: z.string().max(128).optional(),
  expiresAt: z.number().int().positive().safe(),
  fileName: z.string().min(1).max(180),
  id: z.string().regex(/^[A-Za-z0-9_-]{32}$/u),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  state: z.enum([
    "reserved", "uploading", "quarantined", "clean", "rejected",
    "claimed", "consumed",
  ]),
}).strict();

const envelopeSchema = z.object({
  ciphertext: z.string().regex(/^[A-Za-z0-9_-]{1,4096}$/u),
  iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/u),
  tag: z.string().regex(/^[A-Za-z0-9_-]{22}$/u),
  version: z.literal(1),
}).strict();

const key = (root: Buffer): Buffer => Buffer.from(hkdfSync(
  "sha256", root, Buffer.alloc(0),
  "veda-mail/shared-attachment/metadata/v1", 32,
));

const aad = (id: string): Buffer =>
  Buffer.from(`veda-mail/shared-attachment/metadata/v1\0${id}`);

export const encryptSharedAttachmentRecord = (
  root: Buffer,
  record: StoredAttachment,
): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(root), iv);
  cipher.setAAD(aad(record.id));
  const serializable = { ...record };
  delete serializable.operation;
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(serializable), "utf8"), cipher.final(),
  ]);
  return JSON.stringify({
    ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    version: 1,
  });
};

export const decryptSharedAttachmentRecord = (
  root: Buffer,
  id: string,
  serialized: string,
): StoredAttachment => {
  if (Buffer.byteLength(serialized) > 5_120) {
    throw new RangeError("Shared attachment metadata is oversized.");
  }
  const envelope = envelopeSchema.parse(JSON.parse(serialized));
  const decipher = createDecipheriv(
    "aes-256-gcm", key(root), Buffer.from(envelope.iv, "base64url"),
  );
  decipher.setAAD(aad(id));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  const record = recordSchema.parse(JSON.parse(plaintext));
  if (record.id !== id) throw new Error("Shared attachment identity mismatch.");
  return record as StoredAttachment;
};
