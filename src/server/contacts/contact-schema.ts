import {
  canonicalContactEmail,
  type ContactPutOperation,
  MAX_CONTACT_EMAILS,
  MAX_CONTACT_GROUPS,
  MAX_CONTACT_LABEL_CHARACTERS,
  MAX_CONTACT_LABEL_UTF8_BYTES,
  MAX_CONTACT_IMPORT,
  MAX_CONTACT_NAME_CHARACTERS,
  MAX_CONTACT_NAME_UTF8_BYTES,
  MAX_CONTACTS_PER_GROUP,
} from "@/domain/member/contact";
import { hasHeaderControlCharacter } from "@/domain/mail/header-safety";
import {
  hasDisallowedContentControl,
  hasUnpairedContentSurrogate,
  outgoingContentUtf8Bytes,
} from "@/domain/mail/outgoing-content-policy";
import { id } from "@/domain/shared/brand";
import { z } from "zod";

const isSingleLine = (value: string): boolean =>
  ![...value].some((character) =>
    [9, 10, 13, 0x2028, 0x2029].includes(character.codePointAt(0) ?? -1));

const safeSingleLine = (
  label: string,
  maximumCharacters: number,
  maximumBytes: number,
) =>
  z
    .string()
    .max(maximumCharacters, `${label} is too long.`)
    .refine(
      (value) => outgoingContentUtf8Bytes(value) <= maximumBytes,
      `${label} is too large.`,
    )
    .refine(
      (value) => !hasUnpairedContentSurrogate(value),
      `${label} must contain valid Unicode.`,
    )
    .refine(
      (value) => !hasDisallowedContentControl(value),
      `${label} cannot contain unsafe control characters.`,
    )
    .refine(isSingleLine, `${label} must be one line.`)
    .trim();

export const contactNameSchema = safeSingleLine(
  "Contact name",
  MAX_CONTACT_NAME_CHARACTERS,
  MAX_CONTACT_NAME_UTF8_BYTES,
).min(1, "Contact name cannot be blank.");

export const contactLabelSchema = safeSingleLine(
  "Email label",
  MAX_CONTACT_LABEL_CHARACTERS,
  MAX_CONTACT_LABEL_UTF8_BYTES,
).min(1, "Email label cannot be blank.");

export const contactEmailAddressSchema = z
  .string()
  .trim()
  .max(320, "Email address is too long.")
  .email("Enter a valid email address.")
  .refine(
    (value) => !hasHeaderControlCharacter(value),
    "Email address cannot contain control characters.",
  )
  .transform(canonicalContactEmail);

export const contactEmailSchema = z
  .object({
    email: contactEmailAddressSchema,
    label: contactLabelSchema.nullable(),
  })
  .strict();

export const recentRecipientInputSchema = z.object({
  email: contactEmailAddressSchema,
  name: contactNameSchema.nullable(),
}).strict();

export const contactInputSchema = z
  .object({
    emails: z.array(contactEmailSchema).min(1).max(MAX_CONTACT_EMAILS),
    name: contactNameSchema,
  })
  .strict()
  .superRefine((contact, context) => {
    const emails = new Set<string>();
    for (const [index, address] of contact.emails.entries()) {
      const key = address.email.toLowerCase();
      if (emails.has(key)) {
        context.addIssue({
          code: "custom",
          message: "A contact cannot contain the same email address twice.",
          path: ["emails", index, "email"],
        });
        return;
      }
      emails.add(key);
    }
  });

const contactIdSchema = z
  .string()
  .uuid("The contact identifier is invalid.")
  .transform((value) => id.contact(value.toLowerCase()));

const contactGroupIdSchema = z
  .string()
  .uuid("The contact group identifier is invalid.")
  .transform((value) => id.contactGroup(value.toLowerCase()));

export const contactGroupInputSchema = z
  .object({
    contactIds: z
      .array(contactIdSchema)
      .min(1, "A group must contain at least one contact.")
      .max(MAX_CONTACTS_PER_GROUP),
    name: contactNameSchema,
  })
  .strict()
  .superRefine((group, context) => {
    if (new Set(group.contactIds).size !== group.contactIds.length) {
      context.addIssue({
        code: "custom",
        message: "A group cannot contain the same contact twice.",
        path: ["contactIds"],
      });
    }
  });

export const contactImportGroupInputSchema = z.object({
  contactIndexes: z.array(
    z.number().int().nonnegative().max(MAX_CONTACT_IMPORT - 1),
  ).min(1).max(MAX_CONTACTS_PER_GROUP),
  name: contactNameSchema,
}).strict().superRefine((group, context) => {
  if (new Set(group.contactIndexes).size !== group.contactIndexes.length) {
    context.addIssue({
      code: "custom",
      message: "An imported group cannot contain the same contact twice.",
      path: ["contactIndexes"],
    });
  }
});

const revisionSchema = z.string().trim().min(16).max(200).nullable();

export const contactMutationSchema = z.discriminatedUnion("operation", [
  z.object({
    contacts: z.array(contactInputSchema).min(1).max(MAX_CONTACT_IMPORT),
    expectedRevision: revisionSchema,
    groups: z.array(contactImportGroupInputSchema)
      .max(MAX_CONTACT_GROUPS)
      .optional(),
    operation: z.literal("import-contacts"),
  }).strict().superRefine((operation, context) => {
    const names = new Set<string>();
    for (const [index, group] of (operation.groups ?? []).entries()) {
      const key = group.name.normalize("NFKC").toLowerCase();
      if (names.has(key)) {
        context.addIssue({
          code: "custom",
          message: "Imported group names must be unique.",
          path: ["groups", index, "name"],
        });
      }
      names.add(key);
      if (group.contactIndexes.some(
        (contactIndex) => contactIndex >= operation.contacts.length)) {
        context.addIssue({
          code: "custom",
          message: "An imported group references a missing batch contact.",
          path: ["groups", index, "contactIndexes"],
        });
      }
    }
  }),
  z.object({
    contact: contactInputSchema,
    expectedRevision: revisionSchema,
    operation: z.literal("create-contact"),
  }).strict(),
  z.object({
    contact: contactInputSchema,
    contactId: contactIdSchema,
    expectedRevision: revisionSchema,
    operation: z.literal("update-contact"),
  }).strict(),
  z.object({
    contactId: contactIdSchema,
    expectedRevision: revisionSchema,
    operation: z.literal("delete-contact"),
  }).strict(),
  z.object({
    expectedRevision: revisionSchema,
    group: contactGroupInputSchema,
    operation: z.literal("create-group"),
  }).strict(),
  z.object({
    expectedRevision: revisionSchema,
    group: contactGroupInputSchema,
    groupId: contactGroupIdSchema,
    operation: z.literal("update-group"),
  }).strict(),
  z.object({
    expectedRevision: revisionSchema,
    groupId: contactGroupIdSchema,
    operation: z.literal("delete-group"),
  }).strict(),
  z.object({
    expectedRevision: revisionSchema,
    operation: z.literal("clear-recents"),
  }).strict(),
]);

export const parseContactPutOperation = (
  value: unknown,
): ContactPutOperation => contactMutationSchema.parse(value);
