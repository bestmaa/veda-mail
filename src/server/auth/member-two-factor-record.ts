import "server-only";

import { z } from "zod";

const base64url = (length: number) =>
  z.string().regex(new RegExp(`^[A-Za-z0-9_-]{${length}}$`, "u"));

export const recoveryDigestSchema = z.object({
  algorithm: z.literal("sha256"),
  digest: base64url(43),
  salt: base64url(22),
}).strict();

export const encryptedOtpSchema = z.object({
  algorithm: z.literal("aes-256-gcm"),
  ciphertext: z.string().min(1).max(8 * 1024),
  iv: base64url(16),
  tag: base64url(22),
}).strict();

export const memberSecuritySchema = z.object({
  enabledAt: z.string().datetime(),
  otpUrl: encryptedOtpSchema,
  recoveryCodes: z.array(recoveryDigestSchema).max(10),
}).strict();

export const memberSecurityFileSchema = z.object({
  members: z.record(z.string().min(3).max(320), memberSecuritySchema),
  updatedAt: z.string().datetime(),
  version: z.literal(1),
}).strict().refine(
  (file) => Object.keys(file.members).length <= 10_000,
  "The member security store contains too many members.",
);

export const encryptedMemberSecuritySchema = z.object({
  algorithm: z.literal("aes-256-gcm"),
  ciphertext: z.string().min(1).max(32 * 1024),
  iv: base64url(16),
  tag: base64url(22),
}).strict();

export type MemberSecurityFile = z.infer<typeof memberSecurityFileSchema>;
export type MemberSecurity = z.infer<typeof memberSecuritySchema>;
export type RecoveryDigest = z.infer<typeof recoveryDigestSchema>;
export type EncryptedMemberSecurity = z.infer<typeof encryptedMemberSecuritySchema>;
