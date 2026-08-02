import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from "node:crypto";

import type { EmailTemplateOwner } from "@/domain/member/email-template";
import { canonicalizeEmailTemplateContent } from "@/server/templates/email-template-content";
import {
  type EncryptedEmailTemplateBook,
  parseStoredEmailTemplateBook,
  type StoredEmailTemplateBook,
} from "@/server/templates/email-template-record";

const OWNER_CONTEXT = "veda-mail/member-templates/owner/v1";
const ENCRYPTION_CONTEXT = "veda-mail/member-templates/encryption/v1";

const normalizedEmail = (email: string): string => {
  const trimmed = email.trim();
  const separator = trimmed.lastIndexOf("@");
  if (separator < 1) return trimmed;
  return `${trimmed.slice(0, separator)}@${trimmed
    .slice(separator + 1)
    .toLowerCase()}`;
};

const normalizedOwner = (owner: EmailTemplateOwner): string =>
  `${owner.providerId.trim().toLowerCase()}\0${normalizedEmail(owner.email)}`;

export const emailTemplateOwnerKey = (
  owner: EmailTemplateOwner,
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

export const encryptEmailTemplateBook = (
  book: StoredEmailTemplateBook,
  ownerKey: string,
  secret: string,
): EncryptedEmailTemplateBook => {
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const assertExactStoredText = (
  rawBook: unknown,
  book: StoredEmailTemplateBook,
): void => {
  if (!isRecord(rawBook) || !Array.isArray(rawBook["templates"])) {
    throw new Error("Stored template book is not canonical.");
  }
  const rawTemplates = rawBook["templates"];
  if (rawTemplates.length !== book.templates.length) {
    throw new Error("Stored template book is not canonical.");
  }
  for (const [index, template] of book.templates.entries()) {
    const rawTemplate = rawTemplates[index];
    if (
      !isRecord(rawTemplate) ||
      rawTemplate["name"] !== template.name ||
      rawTemplate["subject"] !== template.subject
    ) {
      throw new Error("Stored template text is not canonical.");
    }
  }
};

const assertCanonicalBook = (
  rawBook: unknown,
  book: StoredEmailTemplateBook,
): void => {
  assertExactStoredText(rawBook, book);
  for (const template of book.templates) {
    const canonical = template.htmlBody
      ? canonicalizeEmailTemplateContent({
          htmlBody: template.htmlBody,
          mode: "rich",
          subject: template.subject,
        })
      : canonicalizeEmailTemplateContent({
          body: template.body,
          mode: "plain",
          subject: template.subject,
        });
    if (
      canonical.body !== template.body ||
      canonical.htmlBody !== template.htmlBody ||
      canonical.subject !== template.subject
    ) {
      throw new Error("Stored template content is not canonical.");
    }
  }
};

export const decryptEmailTemplateBook = (
  encrypted: EncryptedEmailTemplateBook,
  ownerKey: string,
  secret: string,
): StoredEmailTemplateBook => {
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
  const book = parseStoredEmailTemplateBook(rawBook);
  assertCanonicalBook(rawBook, book);
  return book;
};
