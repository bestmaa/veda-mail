import {
  MAX_SNOOZE_BULK_ITEMS,
  type SnoozeBulkItem,
} from "@/domain/mail/snooze";
import { id } from "@/domain/shared/brand";
import { z } from "zod";

const wakeAt = z.string().datetime();
const itemSchema = z.object({
  messageId: z.string().min(1).max(2_048).transform(id.message),
  sourceMailboxId: z.string().min(1).max(1_024).transform(id.mailbox),
  wakeAt,
}).strict();
export const snoozeBulkSchema = z.object({
  items: z.array(itemSchema).min(1).max(MAX_SNOOZE_BULK_ITEMS),
}).strict();
export const snoozePatchSchema = z.object({ wakeAt }).strict();
export const snoozeIdSchema = z.string().uuid().transform((value) => value.toLowerCase());
export const parseSnoozeBulk = (value: unknown): readonly SnoozeBulkItem[] =>
  snoozeBulkSchema.parse(value).items;
