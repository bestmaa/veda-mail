import "server-only";

import { z } from "zod";

export const JMAP_SIEVE = "urn:ietf:params:jmap:sieve";
export const MAX_STALWART_SIEVE_SCRIPT_BYTES = 1024 * 1024;
export const VEDA_RULE_SCRIPT_NAME = "Veda Mail Rules";

const boundedUnknownRecord = z.record(z.string().min(1).max(1_024), z.unknown())
  .superRefine((value, context) => {
    if (Object.keys(value).length > 64) {
      context.addIssue({ code: "custom", message: "Too many response entries." });
    }
  });

const accountSieveCapabilitySchema = z.object({
  maxNumberRedirects: z.number().int().nonnegative().nullable(),
  maxNumberScripts: z.number().int().nonnegative().nullable(),
  maxSizeScript: z.number().int().nonnegative().nullable(),
  maxSizeScriptName: z.number().int().positive(),
  sieveExtensions: z.array(z.string().min(1).max(128)).max(256),
}).passthrough();

const serverSieveCapabilitySchema = z.object({
  implementation: z.string().min(1).max(256),
}).passthrough();

const sessionAccountSchema = z.object({
  accountCapabilities: z.record(z.string().max(256), z.unknown()),
  isReadOnly: z.boolean(),
  name: z.string().max(1_024),
}).passthrough();

export const sieveSessionSchema = z.object({
  accounts: z.record(z.string().min(1).max(1_024), sessionAccountSchema)
    .superRefine((value, context) => {
      if (Object.keys(value).length > 64) {
        context.addIssue({ code: "custom", message: "Too many accounts." });
      }
    }),
  capabilities: z.record(z.string().max(256), z.unknown()),
  primaryAccounts: z.record(z.string().max(256), z.string().max(1_024)),
}).passthrough();

export const parseAccountSieveCapability = (value: unknown) =>
  accountSieveCapabilitySchema.safeParse(value);

export const parseServerSieveCapability = (value: unknown) =>
  serverSieveCapabilitySchema.safeParse(value);

const sieveScriptSchema = z.object({
  blobId: z.string().min(1).max(1_024),
  id: z.string().min(1).max(1_024),
  isActive: z.boolean(),
  name: z.string().max(1_024).nullable(),
}).passthrough();

export const sieveGetResultSchema = z.object({
  accountId: z.string().min(1).max(1_024),
  list: z.array(sieveScriptSchema).max(256),
  notFound: z.array(z.string().max(1_024)).max(256),
  state: z.string().min(1).max(1_024),
}).passthrough();

const setItemSchema = z.object({
  blobId: z.string().min(1).max(1_024).optional(),
  id: z.string().min(1).max(1_024).optional(),
  isActive: z.boolean().optional(),
  name: z.string().max(1_024).nullable().optional(),
}).passthrough();

export const sieveSetResultSchema = z.object({
  accountId: z.string().min(1).max(1_024),
  created: z.record(z.string().max(128), setItemSchema).nullable().optional(),
  destroyed: z.array(z.string().max(1_024)).max(256).nullable().optional(),
  newState: z.string().min(1).max(1_024),
  notCreated: boundedUnknownRecord.nullable().optional(),
  notDestroyed: boundedUnknownRecord.nullable().optional(),
  notUpdated: boundedUnknownRecord.nullable().optional(),
  oldState: z.string().min(1).max(1_024),
  updated: z.record(z.string().max(1_024), setItemSchema.nullable())
    .nullable().optional(),
}).passthrough();

export const sieveValidateResultSchema = z.object({
  accountId: z.string().min(1).max(1_024),
  error: z.object({ type: z.string().min(1).max(128) })
    .passthrough().nullable(),
}).passthrough();

export type StalwartSieveScript = z.infer<typeof sieveScriptSchema>;
