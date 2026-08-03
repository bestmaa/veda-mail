import type { MessageSummary } from "@/domain/mail/mail";
import type { MessageId } from "@/domain/shared/brand";

export const CONVERSATION_PAGE_SIZE = 25;
export const MAX_CONVERSATION_MESSAGES = 100;

export type ConversationStrategy = "native" | "references";

export interface ConversationQuery {
  readonly anchorMessageId: MessageId;
  readonly cursor?: string;
  readonly limit: typeof CONVERSATION_PAGE_SIZE;
}

export interface ConversationPage {
  readonly anchorMessageId: MessageId;
  readonly items: readonly MessageSummary[];
  readonly nextCursor: string | null;
  readonly strategy: ConversationStrategy;
  readonly total: number;
  readonly truncated: boolean;
}
