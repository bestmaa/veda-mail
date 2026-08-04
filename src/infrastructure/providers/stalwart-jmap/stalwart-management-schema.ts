import "server-only";

import { z } from "zod";

import { STALWART_JMAP } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

const idSchema = z.string().min(1).max(512);
const boundedText = (maximum: number) =>
  z.preprocess(
    (value) => (typeof value === "string" ? value.slice(0, maximum) : value),
    z.string(),
  );
const safeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const capabilityRecordSchema = z
  .record(z.string().max(512), z.unknown())
  .refine((value) => Object.keys(value).length <= 256, "Too many capabilities.");
const accountCapabilitySchema = z
  .object({ accountCapabilities: capabilityRecordSchema })
  .passthrough();

export const stalwartManagementSessionSchema = z
  .object({
    accounts: z
      .record(z.string().max(512), accountCapabilitySchema)
      .refine((value) => Object.keys(value).length <= 256, "Too many accounts.")
      .optional(),
    apiUrl: z.string().min(1).max(2_048),
    capabilities: capabilityRecordSchema,
    primaryAccounts: z
      .record(z.string().max(512), idSchema)
      .refine(
        (value) => Object.keys(value).length <= 256,
        "Too many primary accounts.",
      )
      .optional(),
  })
  .passthrough()
  .refine(
    ({ accounts, capabilities, primaryAccounts }) => {
      if (STALWART_JMAP in capabilities) return true;
      const accountId = primaryAccounts?.[STALWART_JMAP];
      return Boolean(
        accountId &&
          accounts?.[accountId] &&
          STALWART_JMAP in accounts[accountId].accountCapabilities,
      );
    },
    "The Stalwart management capability is unavailable.",
  );

export const stalwartManagementResponseSchema = z
  .object({
    methodResponses: z
      .array(z.tuple([z.string().max(128), z.unknown(), z.string().max(128)]))
      .max(32),
    sessionState: z.string().max(1_024),
  })
  .passthrough();

export const stalwartQueryResultSchema = z
  .object({
    ids: z.array(idSchema).max(256),
    position: safeInteger,
    queryState: z.string().max(1_024),
    total: safeInteger,
  })
  .passthrough();

export const stalwartDomainSchema = z
  .object({
    directoryId: idSchema.nullable().optional(),
    id: idSchema,
    isEnabled: z.boolean().optional(),
    name: z.string().min(1).max(253),
  })
  .passthrough();

const aliasSchema = z
  .object({
    domainId: idSchema,
    enabled: z.boolean().optional(),
    name: z.string().min(1).max(64),
  })
  .strip();

const aliasCollectionSchema = z
  .union([
    z.array(aliasSchema).max(100),
    z.record(z.string().max(128), aliasSchema).refine(
      (value) => Object.keys(value).length <= 100,
      "Too many aliases.",
    ),
  ])
  .transform((value) => (Array.isArray(value) ? value : Object.values(value)));

export const stalwartUserAccountSchema = z
  .object({
    "@type": z.literal("User"),
    aliases: aliasCollectionSchema.optional(),
    createdAt: z.string().datetime({ offset: true }).nullable().optional(),
    description: boundedText(512).nullable().optional(),
    domainId: idSchema,
    emailAddress: z.string().min(3).max(320),
    id: idSchema,
    locale: z.string().max(64).nullable().optional(),
    name: z.string().min(1).max(64),
    quotas: z.record(z.string().max(64), safeInteger).optional(),
    timeZone: z.string().max(128).nullable().optional(),
    usedDiskQuota: safeInteger.optional(),
  })
  .strip();

export const stalwartAuthenticationSchema = z
  .object({
    directoryId: idSchema.nullable().optional(),
    id: z.literal("singleton"),
  })
  .strip();

export const stalwartGetResultSchema = <T extends z.ZodType>(item: T) =>
  z
    .object({
      list: z.array(item).max(256),
      notFound: z.array(idSchema).max(256),
    })
    .passthrough();

const createdObjectSchema = z.object({ id: idSchema }).strip();
const setErrorSchema = z
  .object({ type: z.string().min(1).max(128) })
  .passthrough();

export const stalwartSetResultSchema = z
  .object({
    created: z.record(z.string().max(128), createdObjectSchema).optional(),
    notCreated: z.record(z.string().max(128), setErrorSchema).optional(),
  })
  .passthrough();

export const stalwartMethodErrorSchema = z
  .object({ type: z.string().min(1).max(128) })
  .passthrough();

export type StalwartManagementResponse = z.infer<
  typeof stalwartManagementResponseSchema
>;
export type StalwartUserAccount = z.infer<typeof stalwartUserAccountSchema>;
