import "server-only";

import { z } from "zod";

import type { SnoozeProviderPlan } from "@/domain/mail/snooze";

export const STALWART_SNOOZED_MAILBOX_PREFIX = "Snoozed · Veda Mail ";

export const classifyStalwartSnoozeState = (
  inSource: boolean,
  inSnoozed: boolean,
): "deleted" | "snoozed" | "visible" => {
  if (!inSource && !inSnoozed) return "deleted";
  return inSnoozed && !inSource ? "snoozed" : "visible";
};

export const stalwartSnoozeEmailResultSchema = z.object({
  accountId: z.string().min(1).max(1_024),
  list: z.array(z.object({
    from: z.array(z.object({
      email: z.string().min(1).max(998),
    }).passthrough()).max(100).optional(),
    id: z.string().min(1).max(1_024),
    keywords: z.record(z.string(), z.boolean()),
    mailboxIds: z.record(z.string(), z.boolean()),
    subject: z.string().max(998).optional(),
  }).passthrough()).max(1),
  notFound: z.array(z.string().max(1_024)).max(1),
  state: z.string().min(1).max(1_024),
}).passthrough();

export const stalwartSnoozeMailboxResultSchema = z.object({
  accountId: z.string().min(1).max(1_024),
  list: z.array(z.object({
    id: z.string().min(1).max(1_024),
    myRights: z.object({
      mayAddItems: z.boolean().optional(),
      mayRemoveItems: z.boolean().optional(),
    }).passthrough().optional(),
    name: z.string().min(1).max(512),
    parentId: z.string().max(1_024).nullable().optional(),
    role: z.string().max(100).nullable().optional(),
  }).passthrough()).max(10_000),
  notFound: z.array(z.string().max(1_024)).max(10_000),
  state: z.string().min(1).max(1_024),
}).passthrough();

export type StalwartSnoozeMailbox = z.infer<
  typeof stalwartSnoozeMailboxResultSchema
>["list"][number];

export type StalwartSnoozePlan = Extract<SnoozeProviderPlan, { kind: "jmap" }>;
