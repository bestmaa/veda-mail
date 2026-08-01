import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from "node:crypto";

import type { MailboxAppearanceOwner } from "@/domain/mail/mailbox";
import {
  type EncryptedMailboxAppearanceBook,
  storedMailboxAppearanceBookSchema,
  type StoredMailboxAppearanceBook,
} from "@/server/mailboxes/mailbox-appearance-record";

const OWNER_CONTEXT = "veda-mail/mailbox-appearance/owner/v1";
const ENCRYPTION_CONTEXT = "veda-mail/mailbox-appearance/encryption/v1";

const normalizedEmail = (email: string): string => {
  const value = email.trim();
  const separator = value.lastIndexOf("@");
  return separator < 1
    ? value
    : `${value.slice(0, separator)}@${value.slice(separator + 1).toLowerCase()}`;
};

export const mailboxAppearanceOwnerKey = (
  owner: MailboxAppearanceOwner,
  secret: string,
): string =>
  createHmac("sha256", secret)
    .update(OWNER_CONTEXT)
    .update("\0")
    .update(`${owner.providerId.trim().toLowerCase()}\0${normalizedEmail(owner.email)}`)
    .digest("base64url");

const encryptionKey = (secret: string): Buffer =>
  Buffer.from(hkdfSync(
    "sha256",
    Buffer.from(secret, "utf8"),
    Buffer.alloc(0),
    ENCRYPTION_CONTEXT,
    32,
  ));

const aad = (ownerKey: string): Buffer =>
  Buffer.from(`${ENCRYPTION_CONTEXT}\0${ownerKey}`, "utf8");

export const encryptMailboxAppearanceBook = (
  book: StoredMailboxAppearanceBook,
  ownerKey: string,
  secret: string,
): EncryptedMailboxAppearanceBook => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  cipher.setAAD(aad(ownerKey));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(book), "utf8"),
    cipher.final(),
  ]);
  return {
    algorithm: "aes-256-gcm",
    ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
  };
};

export const decryptMailboxAppearanceBook = (
  encrypted: EncryptedMailboxAppearanceBook,
  ownerKey: string,
  secret: string,
): StoredMailboxAppearanceBook => {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(secret),
    Buffer.from(encrypted.iv, "base64url"),
  );
  decipher.setAAD(aad(ownerKey));
  decipher.setAuthTag(Buffer.from(encrypted.tag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  return storedMailboxAppearanceBookSchema.parse(JSON.parse(plaintext));
};
