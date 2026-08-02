import type { DraftContent } from "@/domain/mail/draft";
import type { ProviderConnection } from "@/domain/provider/provider";
import type {
  DraftId,
  ProviderDraftId,
  ProviderId,
  ScheduledMessageId,
} from "@/domain/shared/brand";

export const MAX_SCHEDULED_MESSAGES_PER_OWNER = 100;
export const MAX_SCHEDULED_MESSAGE_OWNERS = 10_000;
export const MIN_SCHEDULE_DELAY_MS = 5_000;
export const MAX_SCHEDULE_DELAY_MS = 366 * 24 * 60 * 60 * 1_000;

export interface ScheduledMessageOwner {
  readonly email: string;
  readonly providerId: ProviderId;
}

export interface ScheduledSendRequest extends DraftContent {
  readonly draftId: DraftId;
  readonly expectedDraftRevision: string;
  readonly providerDraftId: ProviderDraftId;
}

export type ScheduledMessageStatus =
  | "failed"
  | "pending"
  | "retrying"
  | "sending"
  | "uncertain";

export interface ScheduledMessage {
  readonly attemptCount: number;
  readonly createdAt: string;
  readonly id: ScheduledMessageId;
  readonly lastError: string | null;
  readonly recipientCount: number;
  readonly scheduledAt: string;
  readonly status: ScheduledMessageStatus;
  readonly subject: string;
  readonly updatedAt: string;
}

export interface ScheduledMessageBook {
  readonly messages: readonly ScheduledMessage[];
  readonly revision: string | null;
  readonly version: 1;
}

export interface ScheduleMessageInput {
  readonly connection: ProviderConnection;
  readonly owner: ScheduledMessageOwner;
  readonly request: ScheduledSendRequest;
  readonly scheduledAt: string;
}
