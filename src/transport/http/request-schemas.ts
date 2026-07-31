import { hasHeaderControlCharacter } from "@/domain/mail/header-safety";
import { id } from "@/domain/shared/brand";
import {
  combinedOutgoingContentWithinLimit,
  outgoingContentString,
} from "@/transport/http/outgoing-content-schema";
import {
  draftRevisionSchema,
  providerDraftIdSchema,
} from "@/transport/http/draft-reference-schemas";
import { z } from "zod";

export const mailAddressSchema = z
  .object({
    email: z
      .string()
      .trim()
      .max(254, "Email addresses cannot exceed 254 characters.")
      .email("Enter a valid email address."),
    name: z
      .string()
      .trim()
      .max(200, "Recipient names cannot exceed 200 characters.")
      .refine(
        (name) => !hasHeaderControlCharacter(name),
        "Recipient names cannot contain control characters.",
      )
      .transform((name) => name || null)
      .nullable(),
  })
  .strict();

export const recipientListSchema = z
  .array(mailAddressSchema)
  .max(100, "Each recipient field can contain at most 100 addresses.");

export const uniqueMailAddresses = (
  addresses: readonly z.infer<typeof mailAddressSchema>[],
  seen: Set<string>,
): z.infer<typeof mailAddressSchema>[] =>
  addresses.filter((address) => {
    const key = address.email.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

export const attachmentReservationSchema = z
  .object({
    declaredMimeType: z.string().trim().min(1).max(127),
    draftId: z
      .string()
      .uuid("The attachment draft identifier is invalid.")
      .transform((value) => id.draft(value.toLowerCase())),
    fileName: z.string().trim().min(1).max(255),
    size: z.number().int().positive(),
  })
  .strict();

export const attachmentImportSchema = z
  .object({
    draftId: z
      .string()
      .uuid("The attachment draft identifier is invalid.")
      .transform((value) => id.draft(value.toLowerCase())),
  })
  .strict();

export const connectionRequestSchema = z.object({
  config: z.record(z.string(), z.string()),
  displayName: z.string().trim().min(2).max(80),
  providerId: z.string().trim().min(1).transform(id.provider),
});

export const replyMessageIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_048, "Reply message identifiers cannot exceed 2,048 characters.")
  .refine(
    (value) => !hasHeaderControlCharacter(value),
    "Reply message identifiers cannot contain control characters.",
  )
  .transform(id.message);

export const mailSubjectSchema = z
  .string()
  .trim()
  .max(998, "Subject cannot exceed 998 characters.")
  .refine(
    (subject) => !hasHeaderControlCharacter(subject),
    "Subject cannot contain control characters.",
  );

export const sendMessageSchema = z
  .object({
    attachmentIds: z
      .array(z.string().trim().min(16).max(200).transform(id.attachmentUpload))
      .max(10, "A message can contain at most 10 attachments.")
      .default([]),
    bcc: recipientListSchema.default([]),
    body: outgoingContentString("Message body")
      .trim()
      .min(1, "Message body cannot be blank."),
    cc: recipientListSchema.default([]),
    draftId: z
      .string()
      .uuid("The message draft identifier is invalid.")
      .transform((value) => id.draft(value.toLowerCase())),
    expectedDraftRevision: draftRevisionSchema.optional(),
    inReplyTo: replyMessageIdSchema.optional(),
    htmlBody: outgoingContentString("Rich message body").optional(),
    providerDraftId: providerDraftIdSchema.optional(),
    subject: mailSubjectSchema,
    to: recipientListSchema,
  })
  .strict()
  .superRefine((message, context) => {
    if (
      !combinedOutgoingContentWithinLimit(message.body, message.htmlBody)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Combined message content cannot exceed 512,000 characters or UTF-8 bytes.",
        path: ["htmlBody"],
      });
    }
    if (new Set(message.attachmentIds).size !== message.attachmentIds.length) {
      context.addIssue({
        code: "custom",
        message: "Attachment identifiers must be unique.",
        path: ["attachmentIds"],
      });
    }
    if (
      (message.providerDraftId === undefined) !==
      (message.expectedDraftRevision === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "The saved draft identifier and expected revision must be provided together.",
        path: [
          message.providerDraftId === undefined
            ? "providerDraftId"
            : "expectedDraftRevision",
        ],
      });
    }
    if (message.providerDraftId && message.attachmentIds.length > 0) {
      context.addIssue({
        code: "custom",
        message: "Local attachments cannot be added to a saved provider draft.",
        path: ["attachmentIds"],
      });
    }
    const recipientCount =
      message.to.length + message.cc.length + message.bcc.length;
    if (recipientCount > 100) {
      context.addIssue({
        code: "custom",
        message:
          "A message can have at most 100 recipients across To, CC, and BCC.",
        path: ["to"],
      });
    }
  })
  .transform((message) => {
    const seen = new Set<string>();
    return {
      ...message,
      to: uniqueMailAddresses(message.to, seen),
      cc: uniqueMailAddresses(message.cc, seen),
      bcc: uniqueMailAddresses(message.bcc, seen),
    };
  })
  .refine(
    (message) => message.to.length + message.cc.length + message.bcc.length > 0,
    {
      message: "At least one recipient is required.",
      path: ["to"],
    },
  );

export const messageMutationSchema = z.discriminatedUnion("type", [
  z.object({
    messageId: z.string().transform(id.message),
    type: z.enum(["archive", "delete", "restore"]),
  }),
  z.object({
    messageId: z.string().transform(id.message),
    type: z.enum(["set-read", "set-starred"]),
    value: z.boolean(),
  }),
  z.object({
    mailboxId: z.string().transform(id.mailbox),
    messageId: z.string().transform(id.message),
    type: z.literal("move"),
  }),
]);

export const memberProfileUpdateSchema = z
  .object({
    displayName: z.string().trim().min(2).max(80),
  })
  .strict();

export const memberPasswordChangeSchema = z
  .object({
    confirmPassword: z.string(),
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8).max(128),
    otpCode: z
      .string()
      .trim()
      .regex(/^\d{6,8}$/)
      .optional(),
  })
  .strict()
  .refine((input) => input.newPassword === input.confirmPassword, {
    message: "New passwords do not match.",
    path: ["confirmPassword"],
  })
  .transform(({ currentPassword, newPassword, otpCode }) => ({
    currentPassword,
    newPassword,
    ...(otpCode ? { otpCode } : {}),
  }));

const memberTwoFactorProofSchema = z
  .object({
    currentPassword: z.string().min(1).max(1024),
    otpCode: z
      .string()
      .trim()
      .regex(/^\d{6}$/),
  })
  .strict();

export const memberTwoFactorConfirmSchema = memberTwoFactorProofSchema;
export const memberTwoFactorDisableSchema = z
  .object({
    currentPassword: z.string().min(1).max(1024),
    otpCode: z.string().trim().min(1).max(64),
  })
  .strict();
