import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";

import {
  type EncryptedMemberSecurity,
  type MemberSecurity,
  memberSecuritySchema,
} from "@/server/auth/member-two-factor-record";

const OTP_CONTEXT = "veda-mail/member-two-factor/v1";
const RECORD_CONTEXT = "veda-mail/member-two-factor/record/v1";
const key = (context: string, sessionSecret: string): Buffer =>
  createHash("sha256").update(context).update("\0").update(sessionSecret).digest();

export const normalizedMemberEmail = (email: string): string =>
  email.trim().toLowerCase();

export const memberSecurityOwnerKey = (
  email: string,
  sessionSecret: string,
): string => createHmac("sha256", key(RECORD_CONTEXT, sessionSecret))
  .update("owner-index\0")
  .update(normalizedMemberEmail(email))
  .digest("base64url");

export const encryptOtpUrl = (
  value: string,
  email: string,
  sessionSecret: string,
): MemberSecurity["otpUrl"] => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(OTP_CONTEXT, sessionSecret), iv);
  cipher.setAAD(Buffer.from(`${OTP_CONTEXT}\0${email}`));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    algorithm: "aes-256-gcm",
    ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
  };
};

export const decryptOtpUrl = (
  value: MemberSecurity["otpUrl"],
  email: string,
  sessionSecret: string,
): string => {
  const decipher = createDecipheriv(
    "aes-256-gcm", key(OTP_CONTEXT, sessionSecret),
    Buffer.from(value.iv, "base64url"),
  );
  decipher.setAAD(Buffer.from(`${OTP_CONTEXT}\0${email}`));
  decipher.setAuthTag(Buffer.from(value.tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
};

const recordAad = (ownerKey: string) =>
  Buffer.from(`${RECORD_CONTEXT}\0${ownerKey}`);

export const encryptMemberSecurity = (
  value: MemberSecurity,
  ownerKey: string,
  sessionSecret: string,
): EncryptedMemberSecurity => {
  const canonical = memberSecuritySchema.parse(value);
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm", key(RECORD_CONTEXT, sessionSecret), iv,
  );
  cipher.setAAD(recordAad(ownerKey));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(canonical), "utf8"), cipher.final(),
  ]);
  return { algorithm: "aes-256-gcm", ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url") };
};

export const decryptMemberSecurity = (
  value: EncryptedMemberSecurity,
  ownerKey: string,
  sessionSecret: string,
): MemberSecurity => {
  const decipher = createDecipheriv(
    "aes-256-gcm", key(RECORD_CONTEXT, sessionSecret),
    Buffer.from(value.iv, "base64url"),
  );
  decipher.setAAD(recordAad(ownerKey));
  decipher.setAuthTag(Buffer.from(value.tag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64url")), decipher.final(),
  ]).toString("utf8");
  const parsed = memberSecuritySchema.parse(JSON.parse(plaintext));
  if (JSON.stringify(parsed) !== plaintext) throw new Error("Noncanonical member security.");
  return parsed;
};
