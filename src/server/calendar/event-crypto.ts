import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from "node:crypto";

import {
  type EncryptedCalendarEventBook,
  parseStoredCalendarEventBook,
  type StoredCalendarEventBook,
} from "@/server/calendar/event-record";
import type { CalendarEventOwner } from "@/server/calendar/event-owner";

const OWNER_CONTEXT = "veda-mail/member-calendar-events/owner/v1";
const ENCRYPTION_CONTEXT = "veda-mail/member-calendar-events/encryption/v1";

const canonicalOwnerEmail = (email: string): string => {
  const value = email.trim();
  const separator = value.lastIndexOf("@");
  return separator < 1
    ? value
    : `${value.slice(0, separator)}@${value.slice(separator + 1).toLowerCase()}`;
};

const normalizedOwner = (owner: CalendarEventOwner): string =>
  `${owner.providerId.trim().toLowerCase()}\0${canonicalOwnerEmail(owner.email)}`;

export const calendarEventOwnerKey = (
  owner: CalendarEventOwner,
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

export const encryptCalendarEventBook = (
  book: StoredCalendarEventBook,
  ownerKey: string,
  secret: string,
): EncryptedCalendarEventBook => {
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

export const decryptCalendarEventBook = (
  encrypted: EncryptedCalendarEventBook,
  ownerKey: string,
  secret: string,
): StoredCalendarEventBook => {
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
  const book = parseStoredCalendarEventBook(rawBook);
  if (JSON.stringify(rawBook) !== JSON.stringify(book)) {
    throw new Error("Stored calendar-event book is not canonical.");
  }
  return book;
};
