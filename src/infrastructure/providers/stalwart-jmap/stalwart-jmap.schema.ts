import "server-only";

import { z } from "zod";

const stringRecord = z.record(z.string(), z.string());
const booleanRecord = z.record(z.string(), z.boolean());
const unknownRecord = z.record(z.string(), z.unknown());

const addressSchema = z
  .object({
    email: z.string().min(1),
    name: z.string().nullable().optional(),
  })
  .passthrough();

const bodyPartSchema = z
  .object({
    blobId: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    partId: z.string().nullable().optional(),
    size: z.number().nonnegative().nullable().optional(),
    type: z.string().min(1),
  })
  .passthrough();

export const jmapEmailSchema = z
  .object({
    attachments: z.array(bodyPartSchema).optional(),
    bcc: z.array(addressSchema).nullable().optional(),
    bodyValues: z
      .record(
        z.string(),
        z.object({ value: z.string() }).passthrough(),
      )
      .optional(),
    cc: z.array(addressSchema).nullable().optional(),
    from: z.array(addressSchema).nullable().optional(),
    hasAttachment: z.boolean(),
    htmlBody: z.array(bodyPartSchema).optional(),
    id: z.string().min(1),
    keywords: booleanRecord,
    mailboxIds: booleanRecord,
    preview: z.string().default(""),
    receivedAt: z.string().min(1),
    size: z.number().nonnegative(),
    subject: z.string().nullable(),
    textBody: z.array(bodyPartSchema).optional(),
    threadId: z.string().min(1),
    to: z.array(addressSchema).nullable().optional(),
  })
  .passthrough();

export const jmapMailboxSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    role: z.string().nullable().optional(),
    totalEmails: z.number().int().nonnegative(),
    unreadEmails: z.number().int().nonnegative(),
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
    capabilities: unknownRecord,
    downloadUrl: z.string().min(1),
    primaryAccounts: stringRecord,
    uploadUrl: z.string().min(1),
    username: z.string(),
  })
  .passthrough();

export const jmapResponseSchema = z
  .object({
    methodResponses: z.array(
      z.tuple([z.string(), z.unknown(), z.string()]),
    ),
    sessionState: z.string(),
  })
  .passthrough();

export const jmapListResultSchema = <T extends z.ZodType>(
  itemSchema: T,
) =>
  z
    .object({
      accountId: z.string().min(1),
      list: z.array(itemSchema),
      state: z.string(),
    })
    .passthrough();

export const jmapQueryResultSchema = z
  .object({
    ids: z.array(z.string()),
    position: z.number().int().nonnegative(),
    queryState: z.string(),
    total: z.number().int().nonnegative(),
  })
  .passthrough();

const createdItemSchema = z.object({ id: z.string().min(1) }).passthrough();

export const jmapSetResultSchema = z
  .object({
    created: z.record(z.string(), createdItemSchema).optional(),
    notCreated: unknownRecord.optional(),
    notUpdated: unknownRecord.optional(),
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
