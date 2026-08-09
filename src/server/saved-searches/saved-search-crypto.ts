import "server-only";

import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";
import type { SavedSearchOwner } from "@/domain/mail/saved-search";
import {
  type EncryptedSavedSearchBook,
  parseStoredSavedSearchBook,
  type StoredSavedSearchBook,
} from "@/server/saved-searches/saved-search-record";

const OWNER_CONTEXT = "veda-mail/saved-searches/owner/v1";
const ENCRYPTION_CONTEXT = "veda-mail/saved-searches/encryption/v1";
const canonicalOwnerEmail = (value: string): string => {
  const trimmed = value.trim();
  const separator = trimmed.lastIndexOf("@");
  return separator < 1 ? trimmed : `${trimmed.slice(0, separator)}@${trimmed.slice(separator + 1).toLowerCase()}`;
};
const normalizedOwner = (owner: SavedSearchOwner): string =>
  `${owner.providerId.trim().toLowerCase()}\0${canonicalOwnerEmail(owner.email)}`;

export const savedSearchOwnerKey = (owner: SavedSearchOwner, secret: string): string =>
  createHmac("sha256", secret).update(OWNER_CONTEXT).update("\0")
    .update(normalizedOwner(owner)).digest("base64url");
const encryptionKey = (secret: string): Buffer => Buffer.from(hkdfSync(
  "sha256", Buffer.from(secret, "utf8"), Buffer.alloc(0), ENCRYPTION_CONTEXT, 32,
));
const aad = (ownerKey: string): Buffer =>
  Buffer.from(`${ENCRYPTION_CONTEXT}\0${ownerKey}`, "utf8");

export const encryptSavedSearchBook = (
  book: StoredSavedSearchBook, ownerKey: string, secret: string,
): EncryptedSavedSearchBook => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  cipher.setAAD(aad(ownerKey));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(book), "utf8"), cipher.final()]);
  return { algorithm: "aes-256-gcm", ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url") };
};

export const decryptSavedSearchBook = (
  encrypted: EncryptedSavedSearchBook, ownerKey: string, secret: string,
): StoredSavedSearchBook => {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), Buffer.from(encrypted.iv, "base64url"));
  decipher.setAAD(aad(ownerKey));
  decipher.setAuthTag(Buffer.from(encrypted.tag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64url")), decipher.final(),
  ]).toString("utf8");
  const raw: unknown = JSON.parse(plaintext);
  const book = parseStoredSavedSearchBook(raw);
  if (JSON.stringify(raw) !== JSON.stringify(book)) throw new Error("Stored saved search book is not canonical.");
  return book;
};
