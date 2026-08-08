import "server-only";

import { z } from "zod";

import { boundJmapBodyValues } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-body-values";
import { boundStalwartDraftStructure } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-structure-bound";
import { jmapSetResultSchema } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.schema";
import { MAX_JMAP_BODY_VALUE_CHARACTERS } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";
import {
  jmapIdBooleanRecordSchema,
  jmapKeywordBooleanRecordSchema,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-record.schema";

const addressSchema = z
  .object({
    email: z.string().min(1).max(998),
    name: z.string().max(4_096).nullable().optional(),
  })
  .passthrough();
const identifierListSchema = z.array(z.string().min(1).max(2_048)).max(256);
const headerSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(256)
      .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/),
    value: z.string().max(8_192),
  })
  .passthrough();
type BodyPart = {
  readonly blobId?: string | null | undefined;
  readonly charset?: string | null | undefined;
  readonly cid?: string | null | undefined;
  readonly disposition?: string | null | undefined;
  readonly headers?: readonly z.infer<typeof headerSchema>[] | undefined;
  readonly language?: readonly string[] | null | undefined;
  readonly location?: string | null | undefined;
  readonly name?: string | null | undefined;
  readonly partId?: string | null | undefined;
  readonly size?: number | null | undefined;
  readonly subParts?: readonly BodyPart[] | null | undefined;
  readonly type: string;
};
const bodyPartSchema: z.ZodType<BodyPart> = z.lazy(() =>
  z
    .object({
      blobId: z.string().min(1).max(1_024).nullable().optional(),
      charset: z.string().max(256).nullable().optional(),
      cid: z.string().max(4_096).nullable().optional(),
      disposition: z.string().max(256).nullable().optional(),
      headers: z.array(headerSchema).max(256).optional(),
      language: z.array(z.string().max(256)).max(16).nullable().optional(),
      location: z.string().max(4_096).nullable().optional(),
      name: z.string().max(4_096).nullable().optional(),
      partId: z.string().max(1_024).nullable().optional(),
      size: z.number().int().nonnegative().nullable().optional(),
      subParts: z.array(bodyPartSchema).max(256).nullable().optional(),
      type: z.string().min(1).max(256),
    })
    .passthrough(),
);
const groupedAddressSchema = z.object({
  addresses: z.array(addressSchema).max(100).nullable(),
  name: z.string().max(4_096).nullable(),
});
const groupedAddressHeadersSchema = z
  .array(z.array(groupedAddressSchema).max(100).nullable())
  .max(256)
  .nullable()
  .optional();

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const normalizePlainBodyAlias = (value: unknown): unknown => {
  const email = record(value);
  const textBody = email?.["textBody"];
  const htmlBody = email?.["htmlBody"];
  const soleTextPart = Array.isArray(textBody) && textBody.length === 1
    ? record(textBody[0])
    : null;
  if (
    typeof soleTextPart?.["type"] === "string" &&
    soleTextPart["type"].trim().toLowerCase() === "text/plain" &&
    Array.isArray(textBody) &&
    Array.isArray(htmlBody) &&
    JSON.stringify(textBody) === JSON.stringify(htmlBody)
  ) {
    return { ...email, htmlBody: [] };
  }
  return value;
};

export const jmapDraftEmailSchema = z.preprocess(
  (value) => normalizePlainBodyAlias(
    boundStalwartDraftStructure(
      boundJmapBodyValues(value, ["textBody", "htmlBody"]),
    ),
  ),
  z
    .object({
      attachments: z.array(bodyPartSchema).max(256).optional(),
      bcc: z.array(addressSchema).max(100).nullable().optional(),
      bodyValues: z
        .record(
          z.string(),
          z.object({
            isEncodingProblem: z.boolean().optional(),
            isTruncated: z.boolean().optional(),
            value: z.string().max(MAX_JMAP_BODY_VALUE_CHARACTERS),
          }),
        )
        .optional(),
      bodyValuesTruncated: z.boolean().optional(),
      bodyStructure: bodyPartSchema.optional(),
      cc: z.array(addressSchema).max(100).nullable().optional(),
      hasAttachment: z.boolean(),
      htmlBody: z.array(bodyPartSchema).max(1_024).optional(),
      headers: z.array(headerSchema).max(256).optional(),
      "header:Bcc:asGroupedAddresses:all": groupedAddressHeadersSchema,
      "header:Cc:asGroupedAddresses:all": groupedAddressHeadersSchema,
      "header:From:asGroupedAddresses:all": groupedAddressHeadersSchema,
      "header:To:asGroupedAddresses:all": groupedAddressHeadersSchema,
      id: z.string().min(1).max(1_024),
      inReplyTo: identifierListSchema.nullable().optional(),
      keywords: jmapKeywordBooleanRecordSchema,
      mailboxIds: jmapIdBooleanRecordSchema,
      messageId: identifierListSchema.nullable().optional(),
      from: z.array(addressSchema).max(100).nullable().optional(),
      receivedAt: z.string().min(1).max(128),
      references: identifierListSchema.nullable().optional(),
      replyTo: z.array(addressSchema).max(100).nullable().optional(),
      sender: z.array(addressSchema).max(100).nullable().optional(),
      subject: z.string().max(998).nullable(),
      textBody: z.array(bodyPartSchema).max(1_024).optional(),
      to: z.array(addressSchema).max(100).nullable().optional(),
    })
    .passthrough(),
);

export const jmapDraftSetResultSchema = jmapSetResultSchema.extend({
  accountId: z.string().min(1).max(1_024),
  destroyed: z.array(z.string().min(1).max(1_024)).max(1_024).nullish(),
  newState: z.string().min(1).max(1_024),
  notDestroyed: z.record(z.string(), z.unknown()).nullish(),
  oldState: z.string().min(1).max(1_024),
});

export const jmapDraftQueryResultSchema = z
  .object({
    accountId: z.string().min(1).max(1_024),
    ids: z.array(z.string().min(1).max(1_024)).max(3),
    position: z.number().int().nonnegative(),
    queryState: z.string().min(1).max(1_024),
    total: z.number().int().nonnegative(),
  })
  .passthrough();

export type JmapDraftEmail = z.infer<typeof jmapDraftEmailSchema>;
export type JmapDraftSetResult = z.infer<typeof jmapDraftSetResultSchema>;
