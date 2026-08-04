import "server-only";

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

import type { SnoozeOwner } from "@/domain/mail/snooze";
import { snoozeSubkey } from "@/server/snooze/snooze-key";
import {
  type EncryptedSnoozeJobBook,
  type SnoozeJobBook,
  snoozeJobBookSchema,
} from "@/server/snooze/snooze-record";

const normalizedEmail = (email: string): string => {
  const value = email.trim();
  const separator = value.lastIndexOf("@");
  return separator < 1 ? value
    : `${value.slice(0, separator)}@${value.slice(separator + 1).toLowerCase()}`;
};
export const snoozeOwnerKey = (owner: SnoozeOwner): string => {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(owner.accountScope)) {
    throw new Error("Snooze account scope is invalid.");
  }
  return createHmac("sha256", snoozeSubkey("owner-index"))
    .update(owner.providerId.trim().toLowerCase()).update("\0")
    .update(normalizedEmail(owner.email)).update("\0")
    .update(owner.accountScope).digest("base64url");
};
const aad = (ownerKey: string) =>
  Buffer.from(`veda-mail/snooze/payload/v1\0${ownerKey}`, "utf8");

export const encryptSnoozeJobBook = (
  book: SnoozeJobBook,
  ownerKey: string,
): EncryptedSnoozeJobBook => {
  const canonical = snoozeJobBookSchema.parse(book);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", snoozeSubkey("payload-encryption"), iv);
  cipher.setAAD(aad(ownerKey));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(canonical), "utf8"), cipher.final(),
  ]);
  return { algorithm: "aes-256-gcm", ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url") };
};

export const decryptSnoozeJobBook = (
  encrypted: EncryptedSnoozeJobBook,
  ownerKey: string,
): SnoozeJobBook => {
  const decipher = createDecipheriv(
    "aes-256-gcm", snoozeSubkey("payload-encryption"),
    Buffer.from(encrypted.iv, "base64url"),
  );
  decipher.setAAD(aad(ownerKey));
  decipher.setAuthTag(Buffer.from(encrypted.tag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64url")), decipher.final(),
  ]).toString("utf8");
  return snoozeJobBookSchema.parse(JSON.parse(plaintext));
};
