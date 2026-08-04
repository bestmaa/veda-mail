import type {
  MailboxId,
  MessageId,
  ProviderId,
} from "@/domain/shared/brand";

export const MAX_SNOOZED_MESSAGES_PER_OWNER = 100;
export const MAX_SNOOZE_OWNERS = 10_000;
export const MAX_SNOOZE_BULK_ITEMS = 100;
export const MAX_SNOOZE_DELAY_MS = 366 * 24 * 60 * 60 * 1_000;
export const MIN_SNOOZE_DELAY_MS = 5_000;
export const MAX_SNOOZE_REQUEST_BYTES = 128 * 1_024;

export interface SnoozeOwner {
  readonly email: string;
  readonly providerId: ProviderId;
}
export type SnoozeStatus = "failed" | "hiding" | "needs-auth" |
  "retry-hide" | "retry-wake" | "snoozed" | "waking";
export interface SnoozedMessage {
  readonly attemptCount: number;
  readonly createdAt: string;
  readonly from: readonly string[];
  readonly id: string;
  readonly lastError: string | null;
  readonly messageId: MessageId;
  readonly status: SnoozeStatus;
  readonly subject: string;
  readonly updatedAt: string;
  readonly wakeAt: string;
}
export interface SnoozedMessageBook {
  readonly messages: readonly SnoozedMessage[];
  readonly revision: string | null;
  readonly version: 1;
}
export type SnoozeCapability = {
  readonly maxMessages: 100;
  readonly snoozedMailboxId: MailboxId;
  readonly supported: true;
} | {
  readonly maxMessages: 0;
  readonly reason: string;
  readonly snoozedMailboxId: null;
  readonly supported: false;
};
export interface SnoozeBulkItem {
  readonly messageId: MessageId;
  readonly sourceMailboxId: MailboxId;
  readonly wakeAt: string;
}
export interface SnoozeBulkOutcome {
  readonly errorCode: string | null;
  readonly messageId: MessageId;
  readonly snoozeId: string | null;
  readonly status: "accepted" | "rejected";
}
export interface SnoozeBulkResult {
  readonly book: SnoozedMessageBook;
  readonly outcomes: readonly SnoozeBulkOutcome[];
}
