import "server-only";

import { z } from "zod";

import {
  MAX_SNOOZE_OWNERS,
  MAX_SNOOZED_MESSAGES_PER_OWNER,
} from "@/domain/mail/snooze";
import type {
  SnoozeOwnedMailbox,
  SnoozeProviderPlan,
} from "@/domain/mail/snooze";

const bounded = (maximum: number) => z.string().min(1).max(maximum);
const connectionSchema = z.object({
  config: z.record(bounded(100), z.string().max(16 * 1024)),
  createdAt: z.string().datetime(), displayName: bounded(80),
  id: z.string().uuid(), providerId: bounded(100),
}).strict().refine((value) => Object.keys(value.config).length <= 64)
  .refine((value) => Buffer.byteLength(JSON.stringify(value.config)) <= 128 * 1024);

const jmapPlanSchema = z.object({
  emailId: bounded(1_024), expectedState: bounded(1_024).nullable(),
  inboxMailboxId: bounded(1_024), kind: z.literal("jmap"),
  originalMailboxIds: z.array(bounded(1_024)).min(1).max(32),
  snoozedMailboxId: bounded(1_024).nullable(),
  snoozedMailboxName: bounded(160),
  sourceMailboxId: bounded(1_024),
}).strict();
const imapPlanSchema = z.object({
  accountScope: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  destinationMailbox: bounded(4_096), kind: z.literal("imap"),
  emailObjectId: bounded(1_024).nullable(),
  marker: z.string().regex(/^veda-snooze-[a-z2-7]{26}$/u),
  snoozedMailbox: bounded(4_096), snoozedMailboxObjectId: bounded(1_024).nullable(),
  snoozedUid: z.number().int().positive().nullable(),
  snoozedUidValidity: bounded(64).nullable(), sourceMailbox: bounded(4_096),
  sourceMailboxObjectId: bounded(1_024).nullable(),
  sourceUid: z.number().int().positive(), sourceUidValidity: bounded(64),
}).strict();
export const snoozeProviderPlanSchema = z.discriminatedUnion("kind", [
  jmapPlanSchema, imapPlanSchema,
]);
const ownedMailboxSchema = z.discriminatedUnion("kind", [
  z.object({ id: bounded(1_024).nullable(), kind: z.literal("jmap"),
    name: bounded(160) }).strict(),
  z.object({ accountScope: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    id: bounded(1_024).nullable(), kind: z.literal("imap"), name: bounded(4_096),
    objectId: bounded(1_024).nullable() }).strict(),
]);

export const snoozeJobSchema = z.object({
  attemptCount: z.number().int().min(0).max(6),
  connection: connectionSchema.nullable(), createdAt: z.string().datetime(),
  from: z.array(z.string().min(1).max(998)).max(100), id: z.string().uuid(),
  lastError: z.string().max(200).nullable(), leaseId: bounded(100).nullable(),
  leaseExpiresAt: z.string().datetime().nullable().default(null),
  messageId: bounded(2_048), nextAttemptAt: z.string().datetime(),
  phase: z.enum(["hide", "wake"]),
  plan: snoozeProviderPlanSchema, sourceMailboxId: bounded(1_024),
  state: z.enum(["failed", "hiding", "needs-auth", "retry-hide",
    "retry-wake", "snoozed", "waking"]),
  subject: z.string().max(998), updatedAt: z.string().datetime(),
  version: z.literal(1), wakeAt: z.string().datetime(),
}).strict();
export const snoozeJobBookSchema = z.object({
  jobs: z.array(snoozeJobSchema).max(MAX_SNOOZED_MESSAGES_PER_OWNER),
  mailbox: ownedMailboxSchema.nullable(), revision: bounded(200), version: z.literal(1),
}).strict();
export const encryptedSnoozeJobBookSchema = z.object({
  algorithm: z.literal("aes-256-gcm"),
  ciphertext: bounded(64 * 1024 * 1024),
  iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/u),
  tag: z.string().regex(/^[A-Za-z0-9_-]{22}$/u),
}).strict();
export const snoozeJobFileSchema = z.object({
  keyCheck: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  owners: z.record(z.string().regex(/^[A-Za-z0-9_-]{43}$/u), encryptedSnoozeJobBookSchema),
  updatedAt: z.string().datetime(), version: z.literal(1),
}).strict().refine((file) => Object.keys(file.owners).length <= MAX_SNOOZE_OWNERS);

type AssertProviderPlan = z.infer<typeof snoozeProviderPlanSchema> extends SnoozeProviderPlan
  ? SnoozeProviderPlan extends z.infer<typeof snoozeProviderPlanSchema> ? true : never
  : never;
type AssertOwnedMailbox = z.infer<typeof ownedMailboxSchema> extends SnoozeOwnedMailbox
  ? SnoozeOwnedMailbox extends z.infer<typeof ownedMailboxSchema> ? true : never
  : never;
export const snoozeRecordDomainTypesMatch: AssertProviderPlan & AssertOwnedMailbox = true;
export type SnoozeJob = z.infer<typeof snoozeJobSchema>;
export type SnoozeJobBook = z.infer<typeof snoozeJobBookSchema>;
export type SnoozeJobFile = z.infer<typeof snoozeJobFileSchema>;
export type EncryptedSnoozeJobBook = SnoozeJobFile["owners"][string];
