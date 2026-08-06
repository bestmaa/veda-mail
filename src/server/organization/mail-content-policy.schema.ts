import "server-only";

import { z } from "zod";

import { MAIL_CONTENT_POLICY_LIMITS } from "@/domain/installation/mail-content-policy";

const extensionSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) => value.replace(/^\.+/u, ""))
  .pipe(z.string().regex(/^[a-z0-9][a-z0-9+_-]{0,15}$/u));

const mimeTypeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/u);

const uniqueRules = <T extends z.ZodTypeAny>(schema: T) =>
  z
    .array(schema)
    .max(MAIL_CONTENT_POLICY_LIMITS.maxRulesPerList)
    .transform((values) => [...new Set(values)].sort());

export const mailContentPolicySchema = z
  .object({
    allowedExtensions: uniqueRules(extensionSchema),
    allowedMimeTypes: uniqueRules(mimeTypeSchema),
    blockedExtensions: uniqueRules(extensionSchema),
    blockedMimeTypes: uniqueRules(mimeTypeSchema),
    maxAttachmentBytes: z
      .number()
      .int()
      .min(1)
      .max(MAIL_CONTENT_POLICY_LIMITS.maxAttachmentBytes),
    maxAttachmentsPerMessage: z
      .number()
      .int()
      .min(1)
      .max(MAIL_CONTENT_POLICY_LIMITS.maxAttachmentsPerMessage),
    maxMessageBytes: z
      .number()
      .int()
      .min(1)
      .max(MAIL_CONTENT_POLICY_LIMITS.maxMessageBytes),
  })
  .strict()
  .superRefine((policy, context) => {
    if (policy.maxMessageBytes < policy.maxAttachmentBytes) {
      context.addIssue({
        code: "custom",
        message: "The message limit cannot be smaller than the attachment limit.",
        path: ["maxMessageBytes"],
      });
    }
    for (const [allowed, blocked, path] of [
      [policy.allowedExtensions, policy.blockedExtensions, "blockedExtensions"],
      [policy.allowedMimeTypes, policy.blockedMimeTypes, "blockedMimeTypes"],
    ] as const) {
      if (allowed.some((value) => blocked.includes(value))) {
        context.addIssue({
          code: "custom",
          message: "The same rule cannot be both allowed and blocked.",
          path: [path],
        });
      }
    }
  });

export const mailContentPolicyRecordSchema = z
  .object({
    policy: mailContentPolicySchema,
    updatedAt: z.string().datetime(),
    version: z.literal(1),
  })
  .strict();
