import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from "node:crypto";

import {
  canonicalContactEmail,
  type ContactOwner,
} from "@/domain/member/contact";
import {
  type EncryptedContactBook,
  parseStoredContactBook,
  type StoredContactBook,
} from "@/server/contacts/contact-record";

const OWNER_CONTEXT = "veda-mail/member-contacts/owner/v1";
const ENCRYPTION_CONTEXT = "veda-mail/member-contacts/encryption/v1";

const normalizedOwner = (owner: ContactOwner): string =>
  `${owner.providerId.trim().toLowerCase()}\0${canonicalContactEmail(owner.email)}`;

export const contactOwnerKey = (
  owner: ContactOwner,
  secret: string,
): string => createHmac("sha256", secret)
  .update(OWNER_CONTEXT)
  .update("\0")
  .update(normalizedOwner(owner))
  .digest("base64url");

const encryptionKey = (secret: string): Buffer => Buffer.from(hkdfSync(
  "sha256",
  Buffer.from(secret, "utf8"),
  Buffer.alloc(0),
  ENCRYPTION_CONTEXT,
  32,
));

const aad = (ownerKey: string): Buffer =>
  Buffer.from(`${ENCRYPTION_CONTEXT}\0${ownerKey}`, "utf8");

export const encryptContactBook = (
  book: StoredContactBook,
  ownerKey: string,
  secret: string,
): EncryptedContactBook => {
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

export const decryptContactBook = (
  encrypted: EncryptedContactBook,
  ownerKey: string,
  secret: string,
): StoredContactBook => {
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
  const rawBook: unknown = JSON.parse(plaintext);
  const book = parseStoredContactBook(rawBook);
  if (JSON.stringify(rawBook) !== JSON.stringify(book)) {
    throw new Error("Stored contact book is not canonical.");
  }
  return book;
};
