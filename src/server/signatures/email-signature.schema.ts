import {
  type EmailSignaturePutOperation,
  MAX_EMAIL_SIGNATURE_CONTENT_CHARACTERS,
  MAX_EMAIL_SIGNATURE_CONTENT_UTF8_BYTES,
  MAX_EMAIL_SIGNATURE_NAME_CHARACTERS,
  MAX_EMAIL_SIGNATURE_NAME_UTF8_BYTES,
} from "@/domain/member/email-signature";
import {
  hasDisallowedContentControl,
  hasUnpairedContentSurrogate,
  outgoingContentUtf8Bytes,
} from "@/domain/mail/outgoing-content-policy";
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

export const emailSignatureNameSchema = safeString(
  "Signature name",
  MAX_EMAIL_SIGNATURE_NAME_CHARACTERS,
  MAX_EMAIL_SIGNATURE_NAME_UTF8_BYTES,
)
  .refine(
    (value) => !/[\t\r\n\u2028\u2029]/u.test(value),
    "Signature name must be one line.",
  )
  .trim()
  .min(1, "Signature name cannot be blank.");

const signatureContentString = (label: string) =>
  safeString(
    label,
    MAX_EMAIL_SIGNATURE_CONTENT_CHARACTERS,
    MAX_EMAIL_SIGNATURE_CONTENT_UTF8_BYTES,
  );

export const emailSignatureContentInputSchema = z.discriminatedUnion("mode", [
  z
    .object({
      body: signatureContentString("Signature content")
        .trim()
        .min(1, "Signature content cannot be blank."),
      mode: z.literal("plain"),
    })
    .strict(),
  z
    .object({
      htmlBody: signatureContentString("Rich signature content").min(
        1,
        "Rich signature content cannot be blank.",
      ),
      mode: z.literal("rich"),
    })
    .strict(),
]);

const revisionSchema = z.string().trim().min(16).max(200).nullable();
const signatureIdSchema = z
  .string()
  .uuid("The signature identifier is invalid.")
  .transform((value) => id.signature(value.toLowerCase()));

const createSchema = z
  .object({
    content: emailSignatureContentInputSchema,
    expectedRevision: revisionSchema,
    name: emailSignatureNameSchema,
    operation: z.literal("create"),
  })
  .strict();

const updateSchema = z
  .object({
    content: emailSignatureContentInputSchema,
    expectedRevision: revisionSchema,
    name: emailSignatureNameSchema,
    operation: z.literal("update"),
    signatureId: signatureIdSchema,
  })
  .strict();

const deleteSchema = z
  .object({
    expectedRevision: revisionSchema,
    operation: z.literal("delete"),
    signatureId: signatureIdSchema,
  })
  .strict();

const nullableSignatureId = signatureIdSchema.nullable();
const defaultsSchema = z
  .object({
    expectedRevision: revisionSchema,
    newMessageId: nullableSignatureId,
    operation: z.literal("set-defaults"),
    replyForwardId: nullableSignatureId,
  })
  .strict();

export const emailSignatureMutationSchema = z.discriminatedUnion("operation", [
  createSchema,
  updateSchema,
  deleteSchema,
  defaultsSchema,
]);

export const parseEmailSignaturePutOperation = (
  value: unknown,
): EmailSignaturePutOperation => emailSignatureMutationSchema.parse(value);
