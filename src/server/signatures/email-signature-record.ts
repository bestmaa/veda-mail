import "server-only";

import {
  MAX_EMAIL_SIGNATURE_CONTENT_CHARACTERS,
  MAX_EMAIL_SIGNATURE_CONTENT_UTF8_BYTES,
  MAX_EMAIL_SIGNATURES,
  type EmailSignatureBook,
} from "@/domain/member/email-signature";
import {
  hasDisallowedContentControl,
  hasUnpairedContentSurrogate,
  outgoingContentUtf8Bytes,
} from "@/domain/mail/outgoing-content-policy";
import { id } from "@/domain/shared/brand";
import { emailSignatureNameSchema } from "@/server/signatures/email-signature.schema";
import { z } from "zod";

const canonicalContent = z
  .string()
  .max(MAX_EMAIL_SIGNATURE_CONTENT_CHARACTERS)
  .refine(
    (value) =>
      outgoingContentUtf8Bytes(value) <=
      MAX_EMAIL_SIGNATURE_CONTENT_UTF8_BYTES,
  )
  .refine((value) => !hasUnpairedContentSurrogate(value))
  .refine((value) => !hasDisallowedContentControl(value));

const signatureIdSchema = z
  .string()
  .uuid()
  .transform((value) => id.signature(value.toLowerCase()));

const signatureRecordSchema = z
  .object({
    body: canonicalContent.min(1),
    createdAt: z.string().datetime(),
    htmlBody: canonicalContent.min(1).optional(),
    id: signatureIdSchema,
    name: emailSignatureNameSchema,
    updatedAt: z.string().datetime(),
    version: z.literal(1),
  })
  .strict();

const nullableSignatureId = signatureIdSchema.nullable();

export const storedEmailSignatureBookSchema = z
  .object({
    createdAt: z.string().datetime(),
    defaults: z
      .object({
        newMessageId: nullableSignatureId,
        replyForwardId: nullableSignatureId,
      })
      .strict(),
    revision: z.string().min(16).max(200),
    signatures: z.array(signatureRecordSchema).max(MAX_EMAIL_SIGNATURES),
    updatedAt: z.string().datetime(),
    version: z.literal(1),
  })
  .strict()
  .superRefine((book, context) => {
    const ids = new Set(book.signatures.map(({ id: signatureId }) => signatureId));
    if (ids.size !== book.signatures.length) {
      context.addIssue({
        code: "custom",
        message: "Signature identifiers must be unique.",
        path: ["signatures"],
      });
    }
    const names = new Set<string>();
    for (const signature of book.signatures) {
      const name = signature.name.toLowerCase();
      if (names.has(name)) {
        context.addIssue({
          code: "custom",
          message: "Signature names must be unique.",
          path: ["signatures"],
        });
        break;
      }
      names.add(name);
    }
    if (
      (book.defaults.newMessageId &&
        !ids.has(book.defaults.newMessageId)) ||
      (book.defaults.replyForwardId &&
        !ids.has(book.defaults.replyForwardId))
    ) {
      context.addIssue({
        code: "custom",
        message: "Signature defaults reference a missing signature.",
        path: ["defaults"],
      });
    }
  });

const encryptedRecordSchema = z
  .object({
    algorithm: z.literal("aes-256-gcm"),
    ciphertext: z.string().min(1).max(2 * 1024 * 1024),
    iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/),
    tag: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  })
  .strict();

export const emailSignatureFileSchema = z
  .object({
    owners: z.record(
      z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      encryptedRecordSchema,
    ),
    updatedAt: z.string().datetime(),
    version: z.literal(1),
  })
  .strict();

export type StoredEmailSignatureBook = EmailSignatureBook & {
  readonly createdAt: string;
  readonly revision: string;
  readonly updatedAt: string;
};
export type EmailSignatureFile = z.infer<typeof emailSignatureFileSchema>;
export type EncryptedEmailSignatureBook =
  EmailSignatureFile["owners"][string];

export const parseStoredEmailSignatureBook = (
  value: unknown,
): StoredEmailSignatureBook =>
  storedEmailSignatureBookSchema.parse(value) as StoredEmailSignatureBook;

export const emptyEmailSignatureBook = (): EmailSignatureBook => ({
  createdAt: null,
  defaults: { newMessageId: null, replyForwardId: null },
  revision: null,
  signatures: [],
  updatedAt: null,
  version: 1,
});
