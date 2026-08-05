import "server-only";

import { z } from "zod";

import { boundJmapBodyValues } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-body-values";
import {
  JMAP_CORE,
  MAX_JMAP_BODY_VALUE_CHARACTERS,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";
import {
  jmapIdBooleanRecordSchema,
  jmapKeywordBooleanRecordSchema,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-record.schema";

const stringRecord = z.record(z.string(), z.string());
const unknownRecord = z.record(z.string(), z.unknown());
const jmapCoreCapabilitySchema = z
  .object({
    maxSizeUpload: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .passthrough();
const jmapCapabilitiesSchema = unknownRecord.and(
  z
    .object({
      [JMAP_CORE]: jmapCoreCapabilitySchema,
    })
    .passthrough(),
);

const addressSchema = z
  .object({
    email: z.preprocess(
      (value) => (typeof value === "string" ? value.slice(0, 998) : value),
      z.string().min(1),
    ),
    name: z
      .preprocess(
        (value) => (typeof value === "string" ? value.slice(0, 4_096) : value),
        z.string(),
      )
      .nullable()
      .optional(),
  })
  .passthrough();
const addressListSchema = z.preprocess(
  (value) => (Array.isArray(value) ? value.slice(0, 100) : value),
  z.array(addressSchema),
);
const messageIdentifierListSchema = z.preprocess(
  (value) => (Array.isArray(value) ? value.slice(0, 256) : value),
  z.array(
    z.preprocess(
      (value) => (typeof value === "string" ? value.slice(0, 2_048) : value),
      z.string(),
    ),
  ),
);

const bodyValueSchema = z.object({
  isTruncated: z.boolean().optional(),
  value: z.string().max(MAX_JMAP_BODY_VALUE_CHARACTERS),
});

const bodyPartSchema = z
  .object({
    blobId: z.string().min(1).max(1_024).nullable().optional(),
    cid: z.string().max(4_096).nullable().optional(),
    disposition: z.string().max(256).nullable().optional(),
    name: z.string().max(4_096).nullable().optional(),
    partId: z.string().max(1_024).nullable().optional(),
    size: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .nullable()
      .optional(),
    type: z.string().min(1).max(256),
  })
  .passthrough();

export const jmapAttachmentEmailSchema = z.preprocess(
  (value) => boundJmapBodyValues(value, ["htmlBody"]),
  z
    .object({
      attachments: z.array(bodyPartSchema).max(256).optional(),
      bodyValues: z.record(z.string(), bodyValueSchema).optional(),
      bodyValuesTruncated: z.boolean().optional(),
      htmlBody: z.array(bodyPartSchema).max(1_024).optional(),
      id: z.string().min(1).max(1_024),
    })
    .passthrough(),
);

export const jmapEmailSchema = z.preprocess(
  (value) => boundJmapBodyValues(value, ["textBody", "htmlBody"]),
  z
    .object({
      attachments: z.array(bodyPartSchema).max(256).optional(),
      bcc: addressListSchema.nullable().optional(),
      bodyValues: z.record(z.string(), bodyValueSchema).optional(),
      bodyValuesTruncated: z.boolean().optional(),
      cc: addressListSchema.nullable().optional(),
      from: addressListSchema.nullable().optional(),
      hasAttachment: z.boolean(),
      htmlBody: z.array(bodyPartSchema).max(1_024).optional(),
      id: z.string().min(1),
      keywords: jmapKeywordBooleanRecordSchema,
      mailboxIds: jmapIdBooleanRecordSchema,
      messageId: messageIdentifierListSchema.nullable().optional(),
      preview: z
        .preprocess(
          (value) =>
            typeof value === "string" ? value.slice(0, 16_384) : value,
          z.string(),
        )
        .default(""),
      receivedAt: z.string().min(1),
      references: messageIdentifierListSchema.nullable().optional(),
      replyTo: addressListSchema.nullable().optional(),
      size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      subject: z
        .preprocess(
          (value) => (typeof value === "string" ? value.slice(0, 998) : value),
          z.string(),
        )
        .nullable(),
      textBody: z.array(bodyPartSchema).max(1_024).optional(),
      threadId: z.string().min(1),
      to: addressListSchema.nullable().optional(),
    })
    .passthrough(),
);

export const jmapReplyContextSchema = z
  .object({
    id: z.string().min(1),
    messageId: messageIdentifierListSchema.nullable().optional(),
    references: messageIdentifierListSchema.nullable().optional(),
  })
  .passthrough();

export const jmapSessionSchema = z
  .object({
    accounts: z.record(
      z.string(),
      z
        .object({
          isReadOnly: z.boolean(),
          name: z.string(),
        })
        .passthrough(),
    ),
    apiUrl: z.string().min(1),
    capabilities: jmapCapabilitiesSchema,
    downloadUrl: z.string().min(1),
    eventSourceUrl: z.string().min(1).optional(),
    primaryAccounts: stringRecord,
    uploadUrl: z.string().min(1),
    username: z.string(),
  })
  .passthrough();

export const jmapResponseSchema = z
  .object({
    methodResponses: z
      .array(z.tuple([z.string(), z.unknown(), z.string()]))
      .max(32),
    sessionState: z.string(),
  })
  .passthrough();

export const jmapListResultSchema = <T extends z.ZodType>(itemSchema: T) =>
  z
    .object({
      accountId: z.string().min(1),
      list: z.array(itemSchema).max(1_024),
      state: z.string(),
    })
    .passthrough();

export const jmapQueryResultSchema = z
  .object({
    accountId: z.string().min(1),
    ids: z.array(z.string()).max(1_024),
    position: z.number().int().nonnegative(),
    queryState: z.string(),
    total: z.number().int().nonnegative(),
  })
  .passthrough();

const createdItemSchema = z.object({ id: z.string().min(1) }).passthrough();

export const jmapSetResultSchema = z
  .object({
    accountId: z.string().min(1).optional(),
    created: z.record(z.string(), createdItemSchema).nullish(),
    destroyed: z.array(z.string().min(1)).max(1_024).nullish(),
    newState: z.string().min(1).optional(),
    notCreated: unknownRecord.nullish(),
    notDestroyed: unknownRecord.nullish(),
    notUpdated: unknownRecord.nullish(),
    oldState: z.string().min(1).optional(),
    updated: unknownRecord.nullish(),
  })
  .passthrough();

export const jmapIdentitySchema = z
  .object({
    email: z.string().min(1),
    id: z.string().min(1),
    name: z.string().optional(),
  })
  .passthrough();

export const jmapIdentityResultSchema = z
  .object({
    list: z.array(jmapIdentitySchema),
  })
  .passthrough();

export const jmapAccountPasswordResultSchema = z
  .object({
    list: z.array(
      z
        .object({
          otpAuth: z
            .object({ otpUrl: z.string().nullable().optional() })
            .passthrough(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
