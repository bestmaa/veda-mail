import "server-only";

import type {
  MessageListQuery,
  MessagePage,
  MessageSummary,
} from "@/domain/mail/mail";
import { normalizeMessageListPreview } from "@/domain/mail/message-list-preview";

export const listMockMessages = (
  messages: readonly MessageSummary[],
  query: MessageListQuery,
): MessagePage => {
  const needle = query.search?.trim().toLocaleLowerCase();
  const matching = messages
    .filter((message) => message.mailboxIds.includes(query.mailboxId))
    .filter((message) => {
      if (!needle) return true;
      const senders = message.from.map(({ email }) => email).join(" ");
      return `${message.subject} ${message.preview} ${senders}`
        .toLocaleLowerCase().includes(needle);
    })
    .sort((left, right) => {
      const order = left.receivedAt.localeCompare(right.receivedAt) ||
        left.id.localeCompare(right.id);
      return query.sort === "oldest" ? order : -order;
    });
  const offset = Number(query.cursor ?? "0");
  const items = matching.slice(offset, offset + query.limit).map((message) => ({
    ...structuredClone(message),
    preview: query.includePreview
      ? normalizeMessageListPreview(message.preview)
      : "",
  }));
  const nextOffset = offset + items.length;
  return {
    items,
    nextCursor: nextOffset < matching.length ? String(nextOffset) : null,
    total: matching.length,
  };
};
