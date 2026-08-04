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
  readonly accountScope: string;
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
  readonly snoozedMailboxId: MailboxId | null;
  readonly version: 1;
}
export type SnoozeCapability = {
  readonly maxMessages: 100;
  readonly snoozedMailboxId: MailboxId | null;
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

export type SnoozeOwnedMailbox = {
  readonly id: string | null;
  readonly kind: "jmap";
  readonly name: string;
} | {
  readonly accountScope: string;
  readonly id: string | null;
  readonly kind: "imap";
  readonly name: string;
  readonly objectId: string | null;
};

export type SnoozeProviderPlan = {
  readonly emailId: string;
  readonly expectedState: string | null;
  readonly inboxMailboxId: string;
  readonly kind: "jmap";
  readonly originalMailboxIds: string[];
  readonly snoozedMailboxId: string | null;
  readonly snoozedMailboxName: string;
  readonly sourceMailboxId: string;
} | {
  readonly accountScope: string;
  readonly destinationMailbox: string;
  readonly emailObjectId: string | null;
  readonly kind: "imap";
  readonly marker: string;
  readonly snoozedMailbox: string;
  readonly snoozedMailboxObjectId: string | null;
  readonly snoozedUid: number | null;
  readonly snoozedUidValidity: string | null;
  readonly sourceMailbox: string;
  readonly sourceMailboxObjectId: string | null;
  readonly sourceUid: number;
  readonly sourceUidValidity: string;
};

export type SnoozeProviderState = "deleted" | "snoozed" | "visible";
export interface SnoozeProviderInspection {
  readonly ownedMailbox: SnoozeOwnedMailbox;
  readonly plan: SnoozeProviderPlan;
  readonly state: SnoozeProviderState;
}
export interface SnoozePreflightInput {
  readonly messageId: MessageId;
  readonly operationId: string;
  readonly ownedMailbox: SnoozeOwnedMailbox;
  readonly sourceMailboxId: MailboxId;
}
export interface SnoozePreflightResult {
  readonly from: readonly string[];
  readonly plan: SnoozeProviderPlan;
  readonly subject: string;
}
export interface SnoozeProviderOperationResult {
  readonly ownedMailbox: SnoozeOwnedMailbox;
  readonly plan: SnoozeProviderPlan;
}
export class SnoozeProviderError extends Error {
  public constructor(
    public readonly kind: "authentication" | "terminal" | "transient",
    message = "Snooze provider operation failed.",
  ) {
    super(message);
    this.name = "SnoozeProviderError";
  }
}
