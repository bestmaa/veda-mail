import "server-only";

import {
  type ContactBook,
  contactEmailKey,
  contactNameKey,
  MAX_CONTACT_BOOK_UTF8_BYTES,
  MAX_CONTACT_EMAILS,
  MAX_CONTACT_GROUPS,
  MAX_CONTACTS,
  MAX_CONTACTS_PER_GROUP,
  MAX_RECENT_RECIPIENTS,
} from "@/domain/member/contact";
import { outgoingContentUtf8Bytes } from "@/domain/mail/outgoing-content-policy";
import { id } from "@/domain/shared/brand";
import {
  contactEmailAddressSchema,
  contactEmailSchema,
  contactNameSchema,
} from "@/server/contacts/contact-schema";
import { z } from "zod";

export const MAX_CONTACT_OWNERS = 10_000;

const contactIdSchema = z
  .string()
  .uuid()
  .transform((value) => id.contact(value.toLowerCase()));
const groupIdSchema = z
  .string()
  .uuid()
  .transform((value) => id.contactGroup(value.toLowerCase()));
const timestampSchema = z.string().datetime();

const contactRecordSchema = z.object({
  createdAt: timestampSchema,
  emails: z.array(contactEmailSchema).min(1).max(MAX_CONTACT_EMAILS),
  id: contactIdSchema,
  name: contactNameSchema,
  updatedAt: timestampSchema,
  version: z.literal(1),
}).strict();

const groupRecordSchema = z.object({
  contactIds: z.array(contactIdSchema).min(1).max(MAX_CONTACTS_PER_GROUP),
  createdAt: timestampSchema,
  id: groupIdSchema,
  name: contactNameSchema,
  updatedAt: timestampSchema,
  version: z.literal(1),
}).strict();

const recentRecipientSchema = z.object({
  email: contactEmailAddressSchema,
  lastUsedAt: timestampSchema,
  name: contactNameSchema.nullable(),
  useCount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();

export const storedContactBookSchema = z.object({
  contacts: z.array(contactRecordSchema).max(MAX_CONTACTS),
  createdAt: timestampSchema,
  groups: z.array(groupRecordSchema).max(MAX_CONTACT_GROUPS),
  recents: z.array(recentRecipientSchema).max(MAX_RECENT_RECIPIENTS),
  revision: z.string().min(16).max(200),
  updatedAt: timestampSchema,
  version: z.literal(1),
}).strict().superRefine((book, context) => {
  const contactIds = new Set(book.contacts.map(({ id: value }) => value));
  if (contactIds.size !== book.contacts.length) {
    context.addIssue({ code: "custom", message: "Contact IDs must be unique." });
  }
  const addressKeys = new Set<string>();
  for (const [contactIndex, contact] of book.contacts.entries()) {
    for (const [emailIndex, address] of contact.emails.entries()) {
      const key = contactEmailKey(address.email);
      if (addressKeys.has(key)) {
        context.addIssue({
          code: "custom",
          message: "Contact email addresses must be unique.",
          path: ["contacts", contactIndex, "emails", emailIndex, "email"],
        });
        break;
      }
      addressKeys.add(key);
    }
  }
  const groupIds = new Set(book.groups.map(({ id: value }) => value));
  const groupNames = new Set<string>();
  if (groupIds.size !== book.groups.length) {
    context.addIssue({ code: "custom", message: "Group IDs must be unique." });
  }
  for (const [index, group] of book.groups.entries()) {
    const key = contactNameKey(group.name);
    if (groupNames.has(key)) {
      context.addIssue({
        code: "custom",
        message: "Group names must be unique.",
        path: ["groups", index, "name"],
      });
    }
    groupNames.add(key);
    if (new Set(group.contactIds).size !== group.contactIds.length) {
      context.addIssue({
        code: "custom",
        message: "Group contact references must be unique.",
        path: ["groups", index, "contactIds"],
      });
    }
    if (group.contactIds.some((contactId) => !contactIds.has(contactId))) {
      context.addIssue({
        code: "custom",
        message: "Groups must reference existing contacts.",
        path: ["groups", index, "contactIds"],
      });
    }
  }
  const recentKeys = book.recents.map(({ email }) => contactEmailKey(email));
  if (new Set(recentKeys).size !== recentKeys.length) {
    context.addIssue({
      code: "custom",
      message: "Recent recipient addresses must be unique.",
      path: ["recents"],
    });
  }
  if (outgoingContentUtf8Bytes(JSON.stringify(book)) >
      MAX_CONTACT_BOOK_UTF8_BYTES) {
    context.addIssue({
      code: "custom",
      message: "The contact book exceeds its safe size limit.",
    });
  }
});

export const encryptedContactBookSchema = z.object({
  algorithm: z.literal("aes-256-gcm"),
  ciphertext: z.string().min(1).max(16 * 1024 * 1024),
  iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/u),
  tag: z.string().regex(/^[A-Za-z0-9_-]{22}$/u),
}).strict();

export const contactFileSchema = z.object({
  owners: z.record(
    z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    encryptedContactBookSchema,
  ),
  updatedAt: timestampSchema,
  version: z.literal(1),
}).strict().refine(
  (file) => Object.keys(file.owners).length <= MAX_CONTACT_OWNERS,
  "The contact store contains too many owners.",
);

export type StoredContactBook = ContactBook & {
  readonly createdAt: string;
  readonly revision: string;
  readonly updatedAt: string;
};
export type ContactFile = z.infer<typeof contactFileSchema>;
export type EncryptedContactBook = ContactFile["owners"][string];

export const parseStoredContactBook = (value: unknown): StoredContactBook =>
  storedContactBookSchema.parse(value) as StoredContactBook;

export const emptyContactBook = (): ContactBook => ({
  contacts: [],
  createdAt: null,
  groups: [],
  recents: [],
  revision: null,
  updatedAt: null,
  version: 1,
});
