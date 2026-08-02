import {
  type EmailTemplatePutOperation,
  MAX_EMAIL_TEMPLATE_CONTENT_CHARACTERS,
  MAX_EMAIL_TEMPLATE_CONTENT_UTF8_BYTES,
  MAX_EMAIL_TEMPLATE_NAME_CHARACTERS,
  MAX_EMAIL_TEMPLATE_NAME_UTF8_BYTES,
  MAX_EMAIL_TEMPLATE_SUBJECT_CHARACTERS,
  MAX_EMAIL_TEMPLATE_SUBJECT_UTF8_BYTES,
} from "@/domain/member/email-template";
import {
  hasDisallowedContentControl,
  hasUnpairedContentSurrogate,
  outgoingContentUtf8Bytes,
} from "@/domain/mail/outgoing-content-policy";
import { hasHeaderControlCharacter } from "@/domain/mail/header-safety";
import { id } from "@/domain/shared/brand";
import { z } from "zod";

const safeString = (
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
    );

export const emailTemplateNameSchema = safeString(
  "Template name",
  MAX_EMAIL_TEMPLATE_NAME_CHARACTERS,
  MAX_EMAIL_TEMPLATE_NAME_UTF8_BYTES,
)
  .refine(
    (value) => !/[\t\r\n\u2028\u2029]/u.test(value),
    "Template name must be one line.",
  )
  .trim()
  .min(1, "Template name cannot be blank.");

export const emailTemplateSubjectSchema = z
  .string()
  .max(
    MAX_EMAIL_TEMPLATE_SUBJECT_CHARACTERS,
    `Template subject cannot exceed ${MAX_EMAIL_TEMPLATE_SUBJECT_CHARACTERS} characters.`,
  )
  .refine(
    (value) =>
      outgoingContentUtf8Bytes(value) <=
      MAX_EMAIL_TEMPLATE_SUBJECT_UTF8_BYTES,
    "Template subject is too large.",
  )
  .refine(
    (value) => !hasUnpairedContentSurrogate(value),
    "Template subject must contain valid Unicode.",
  )
  .refine(
    (value) => !hasDisallowedContentControl(value),
    "Template subject cannot contain unsafe control characters.",
  )
  .refine(
    (value) => !hasHeaderControlCharacter(value),
    "Template subject cannot contain control characters.",
  )
  .trim();

const contentString = (label: string) =>
  safeString(
    label,
    MAX_EMAIL_TEMPLATE_CONTENT_CHARACTERS,
    MAX_EMAIL_TEMPLATE_CONTENT_UTF8_BYTES,
  );

export const emailTemplateContentInputSchema = z.discriminatedUnion("mode", [
  z
    .object({
      body: contentString("Template content")
        .trim()
        .min(1, "Template content cannot be blank."),
      mode: z.literal("plain"),
      subject: emailTemplateSubjectSchema,
    })
    .strict(),
  z
    .object({
      htmlBody: contentString("Rich template content").min(
        1,
        "Rich template content cannot be blank.",
      ),
      mode: z.literal("rich"),
      subject: emailTemplateSubjectSchema,
    })
    .strict(),
]);

const revisionSchema = z.string().trim().min(16).max(200).nullable();
const templateIdSchema = z
  .string()
  .uuid("The template identifier is invalid.")
  .transform((value) => id.template(value.toLowerCase()));

const createSchema = z
  .object({
    content: emailTemplateContentInputSchema,
    expectedRevision: revisionSchema,
    name: emailTemplateNameSchema,
    operation: z.literal("create"),
  })
  .strict();

const updateSchema = z
  .object({
    content: emailTemplateContentInputSchema,
    expectedRevision: revisionSchema,
    name: emailTemplateNameSchema,
    operation: z.literal("update"),
    templateId: templateIdSchema,
  })
  .strict();

const deleteSchema = z
  .object({
    expectedRevision: revisionSchema,
    operation: z.literal("delete"),
    templateId: templateIdSchema,
  })
  .strict();

export const emailTemplateMutationSchema = z.discriminatedUnion("operation", [
  createSchema,
  updateSchema,
  deleteSchema,
]);

export const parseEmailTemplatePutOperation = (
  value: unknown,
): EmailTemplatePutOperation => emailTemplateMutationSchema.parse(value);
