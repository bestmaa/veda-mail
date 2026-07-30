import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from "node:crypto";

import type { EmailSignatureOwner } from "@/domain/member/email-signature";
import { canonicalizeEmailSignatureContent } from "@/server/signatures/email-signature-content";
import {
  type EncryptedEmailSignatureBook,
  parseStoredEmailSignatureBook,
  type StoredEmailSignatureBook,
} from "@/server/signatures/email-signature-record";

const OWNER_CONTEXT = "veda-mail/member-signatures/owner/v1";
const ENCRYPTION_CONTEXT = "veda-mail/member-signatures/encryption/v1";

const normalizedOwner = (owner: EmailSignatureOwner): string =>
  `${owner.providerId.trim().toLowerCase()}\0${owner.email.trim().toLowerCase()}`;

export const emailSignatureOwnerKey = (
  owner: EmailSignatureOwner,
  secret: string,
): string =>
  createHmac("sha256", secret)
    .update(OWNER_CONTEXT)
    .update("\0")
    .update(normalizedOwner(owner))
    .digest("base64url");

const encryptionKey = (secret: string): Buffer =>
  Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(secret, "utf8"),
      Buffer.alloc(0),
      ENCRYPTION_CONTEXT,
      32,
    ),
  );

const aad = (ownerKey: string): Buffer =>
  Buffer.from(`${ENCRYPTION_CONTEXT}\0${ownerKey}`, "utf8");

export const encryptEmailSignatureBook = (
  book: StoredEmailSignatureBook,
  ownerKey: string,
  secret: string,
): EncryptedEmailSignatureBook => {
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

const assertCanonicalBook = (book: StoredEmailSignatureBook): void => {
  for (const signature of book.signatures) {
    const canonical = signature.htmlBody
      ? canonicalizeEmailSignatureContent({
          htmlBody: signature.htmlBody,
          mode: "rich",
        })
      : canonicalizeEmailSignatureContent({
          body: signature.body,
          mode: "plain",
        });
    if (
      canonical.body !== signature.body ||
      canonical.htmlBody !== signature.htmlBody
    ) {
      throw new Error("Stored signature content is not canonical.");
    }
  }
};

export const decryptEmailSignatureBook = (
  encrypted: EncryptedEmailSignatureBook,
  ownerKey: string,
  secret: string,
): StoredEmailSignatureBook => {
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
  const book = parseStoredEmailSignatureBook(JSON.parse(plaintext));
  assertCanonicalBook(book);
  return book;
};
