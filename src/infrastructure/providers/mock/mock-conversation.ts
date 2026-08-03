import "server-only";

import {
  MAX_CONVERSATION_MESSAGES,
  type ConversationPage,
  type ConversationQuery,
} from "@/domain/mail/conversation";
import type { MessageDetail } from "@/domain/mail/mail";
import {
  assertConversationSnapshot,
  conversationProviderPosition,
  conversationSnapshot,
  nextConversationProviderCursor,
} from "@/infrastructure/providers/conversation-provider-cursor";

export const readMockConversation = (
  messages: readonly MessageDetail[],
  query: ConversationQuery,
): ConversationPage => {
  const anchor = messages.find(({ id }) => id === query.anchorMessageId);
  if (!anchor) throw new Error("Message not found.");
  const position = conversationProviderPosition(query);
  const allMatches = messages.filter(({ threadId }) =>
    threadId === anchor.threadId).toSorted((left, right) =>
    left.receivedAt.localeCompare(right.receivedAt) ||
    left.id.localeCompare(right.id));
  const matches = allMatches.slice(0, MAX_CONVERSATION_MESSAGES);
  const snapshot = conversationSnapshot(matches);
  assertConversationSnapshot(position.snapshot, snapshot);
  const items = matches.slice(position.offset, position.offset + query.limit);
  const nextOffset = position.offset + items.length;
  return {
    anchorMessageId: query.anchorMessageId,
    items: structuredClone(items),
    nextCursor: nextConversationProviderCursor(nextOffset, matches.length, snapshot),
    strategy: "native",
    total: matches.length,
    truncated: allMatches.length > MAX_CONVERSATION_MESSAGES,
  };
};
