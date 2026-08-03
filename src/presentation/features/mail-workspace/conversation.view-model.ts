import type { ConversationPage } from "@/domain/mail/conversation";
import type { MessageId } from "@/domain/shared/brand";
import {
  formatMessageDate,
  formatSender,
  initials,
} from "@/presentation/shared/formatters/mail-formatters";

export interface ConversationViewModel {
  readonly error: string | null;
  readonly isLoading: boolean;
  readonly isLoadingMore: boolean;
  readonly items: readonly {
    readonly avatar: string;
    readonly date: string;
    readonly id: string;
    readonly isActive: boolean;
    readonly isUnread: boolean;
    readonly onOpen: () => void;
    readonly preview: string;
    readonly sender: string;
    readonly subject: string;
  }[];
  readonly loadMore: (() => void) | null;
  readonly strategyLabel: string;
  readonly total: number;
  readonly truncated: boolean;
}

export const createConversationViewModel = (input: {
  readonly error: string | null;
  readonly isLoading: boolean;
  readonly isLoadingMore: boolean;
  readonly onLoadMore: () => void;
  readonly onOpen: (messageId: string) => void;
  readonly page: ConversationPage | null;
  readonly selectedMessageId: MessageId | null;
}): ConversationViewModel => ({
  error: input.error,
  isLoading: input.isLoading,
  isLoadingMore: input.isLoadingMore,
  items: (input.page?.items ?? []).map((message) => ({
    avatar: initials(formatSender(message.from)),
    date: formatMessageDate(message.receivedAt),
    id: message.id,
    isActive: message.id === input.selectedMessageId,
    isUnread: message.isUnread,
    onOpen: () => input.onOpen(message.id),
    preview: message.preview,
    sender: formatSender(message.from),
    subject: message.subject.trim() || "(No subject)",
  })),
  loadMore: input.page?.nextCursor ? input.onLoadMore : null,
  strategyLabel: input.page?.strategy === "references"
    ? "Matched by reply headers"
    : "Provider thread",
  total: input.page?.total ?? 0,
  truncated: input.page?.truncated ?? false,
});
