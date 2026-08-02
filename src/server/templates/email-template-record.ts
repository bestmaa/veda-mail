import "server-only";

import {
  type EmailTemplateBook,
  emailTemplateNameKey,
  MAX_EMAIL_TEMPLATE_BOOK_UTF8_BYTES,
  MAX_EMAIL_TEMPLATE_CONTENT_CHARACTERS,
  MAX_EMAIL_TEMPLATE_CONTENT_UTF8_BYTES,
  MAX_EMAIL_TEMPLATES,
} from "@/domain/member/email-template";
import {
  hasDisallowedContentControl,
  hasUnpairedContentSurrogate,
  outgoingContentUtf8Bytes,
} from "@/domain/mail/outgoing-content-policy";
import { id } from "@/domain/shared/brand";
import {
  emailTemplateNameSchema,
  emailTemplateSubjectSchema,
} from "@/server/templates/email-template.schema";
import { z } from "zod";

export const MAX_EMAIL_TEMPLATE_OWNERS = 10_000;

const canonicalContent = z
  .string()
  .max(MAX_EMAIL_TEMPLATE_CONTENT_CHARACTERS)
  .refine(
    (value) =>
      outgoingContentUtf8Bytes(value) <=
      MAX_EMAIL_TEMPLATE_CONTENT_UTF8_BYTES,
  )
  .refine((value) => !hasUnpairedContentSurrogate(value))
  .refine((value) => !hasDisallowedContentControl(value));

const templateIdSchema = z
  .string()
  .uuid()
  .transform((value) => id.template(value.toLowerCase()));

const templateRecordSchema = z
  .object({
    body: canonicalContent.min(1),
    createdAt: z.string().datetime(),
    htmlBody: canonicalContent.min(1).optional(),
    id: templateIdSchema,
    name: emailTemplateNameSchema,
    subject: emailTemplateSubjectSchema,
    updatedAt: z.string().datetime(),
    version: z.literal(1),
  })
  .strict();

export const storedEmailTemplateBookSchema = z
  .object({
    createdAt: z.string().datetime(),
    revision: z.string().min(16).max(200),
    templates: z.array(templateRecordSchema).max(MAX_EMAIL_TEMPLATES),
    updatedAt: z.string().datetime(),
    version: z.literal(1),
  })
  .strict()
  .superRefine((book, context) => {
    const ids = new Set(book.templates.map(({ id: templateId }) => templateId));
    if (ids.size !== book.templates.length) {
      context.addIssue({
        code: "custom",
        message: "Template identifiers must be unique.",
        path: ["templates"],
      });
    }
    const names = new Set<string>();
    for (const template of book.templates) {
      const name = emailTemplateNameKey(template.name);
      if (names.has(name)) {
        context.addIssue({
          code: "custom",
          message: "Template names must be unique.",
          path: ["templates"],
        });
        break;
      }
      names.add(name);
    }
    if (
      outgoingContentUtf8Bytes(JSON.stringify(book)) >
      MAX_EMAIL_TEMPLATE_BOOK_UTF8_BYTES
    ) {
      context.addIssue({
        code: "custom",
        message: "The template book exceeds its safe size limit.",
      });
    }
  });

const encryptedRecordSchema = z
  .object({
    algorithm: z.literal("aes-256-gcm"),
    ciphertext: z.string().min(1).max(8 * 1024 * 1024),
    iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/u),
    tag: z.string().regex(/^[A-Za-z0-9_-]{22}$/u),
  })
  .strict();

export const emailTemplateFileSchema = z
  .object({
    owners: z.record(
      z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
      encryptedRecordSchema,
    ),
    updatedAt: z.string().datetime(),
    version: z.literal(1),
  })
  .strict()
  .refine(
    (file) => Object.keys(file.owners).length <= MAX_EMAIL_TEMPLATE_OWNERS,
    "The template store contains too many owners.",
  );

export type StoredEmailTemplateBook = EmailTemplateBook & {
  readonly createdAt: string;
  readonly revision: string;
  readonly updatedAt: string;
};
export type EmailTemplateFile = z.infer<typeof emailTemplateFileSchema>;
export type EncryptedEmailTemplateBook =
  EmailTemplateFile["owners"][string];

export const parseStoredEmailTemplateBook = (
  value: unknown,
): StoredEmailTemplateBook =>
  storedEmailTemplateBookSchema.parse(value) as StoredEmailTemplateBook;

export const emptyEmailTemplateBook = (): EmailTemplateBook => ({
  createdAt: null,
  revision: null,
  templates: [],
  updatedAt: null,
  version: 1,
});
