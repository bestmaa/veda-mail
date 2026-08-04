import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";

import {
  type EncryptedRuleBook,
  type MailRuleOwner,
  parseStoredRuleBook,
  type StoredRuleBook,
} from "@/server/rules/rule-record";
import { ruleSubkey } from "@/server/rules/rule-key";

const normalizedEmail = (email: string): string => {
  const value = email.trim();
  const separator = value.lastIndexOf("@");
  return separator < 1
    ? value
    : `${value.slice(0, separator)}@${value.slice(separator + 1).toLowerCase()}`;
};

export const ruleOwnerKey = (owner: MailRuleOwner): string => createHmac(
  "sha256",
  ruleSubkey("owner-index"),
).update(owner.providerId.trim().toLowerCase())
  .update("\0")
  .update(normalizedEmail(owner.email))
  .digest("base64url");

const aad = (ownerKey: string): Buffer => Buffer.from(
  `veda-mail/member-rules/payload/v1\0${ownerKey}`,
  "utf8",
);

export const encryptRuleBook = (
  book: StoredRuleBook,
  ownerKey: string,
): EncryptedRuleBook => {
  const canonical = parseStoredRuleBook(book);
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    ruleSubkey("payload-encryption"),
    iv,
  );
  cipher.setAAD(aad(ownerKey));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(canonical), "utf8"),
    cipher.final(),
  ]);
  return {
    algorithm: "aes-256-gcm",
    ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
  };
};

export const decryptRuleBook = (
  encrypted: EncryptedRuleBook,
  ownerKey: string,
): StoredRuleBook => {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    ruleSubkey("payload-encryption"),
    Buffer.from(encrypted.iv, "base64url"),
  );
  decipher.setAAD(aad(ownerKey));
  decipher.setAuthTag(Buffer.from(encrypted.tag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  return parseStoredRuleBook(JSON.parse(plaintext));
};
