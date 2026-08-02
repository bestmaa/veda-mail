import "server-only";

import type {
  MessageListQuery,
  MessagePage,
  MessageSummary,
} from "@/domain/mail/mail";
import { normalizeMessageListPreview } from "@/domain/mail/message-list-preview";
import {
  MailSearchUnsupportedError,
  type MailSearchCriterion,
  type MailSearchQuery,
} from "@/domain/mail/mail-search";

const contains = (value: string, needle: string): boolean =>
  value.toLowerCase().includes(needle.toLowerCase());

const matchesCriterion = (
  message: MessageSummary,
  criterion: MailSearchCriterion,
): boolean => {
  if (criterion.type === "text") {
    const values = {
      body: message.preview,
      cc: "",
      from: message.from.map(({ email, name }) => `${name ?? ""} ${email}`).join(" "),
      subject: message.subject,
      text: `${message.subject} ${message.preview} ${
        message.from.map(({ email }) => email).join(" ")}`,
      to: message.to.map(({ email, name }) => `${name ?? ""} ${email}`).join(" "),
    };
    return contains(values[criterion.field], criterion.value);
  }
  if (criterion.type === "date") {
    const receivedDate = message.receivedAt.slice(0, 10);
    return criterion.boundary === "after"
      ? receivedDate >= criterion.date
      : receivedDate < criterion.date;
  }
  if (criterion.type === "size") {
    return criterion.boundary === "larger"
      ? message.size > criterion.bytes
      : message.size < criterion.bytes;
  }
  if (criterion.type === "has-attachment") return message.hasAttachment;
  if (criterion.type === "mailbox") {
    throw new MailSearchUnsupportedError(["in:"]);
  }
  if (criterion.state === "read") return !message.isUnread;
  if (criterion.state === "unread") return message.isUnread;
  if (criterion.state === "starred") return message.isStarred;
  return !message.isStarred;
};

const matchesSearch = (
  message: MessageSummary,
  query?: MailSearchQuery,
): boolean => query?.criteria.every((item) => matchesCriterion(message, item)) ?? true;

export const listMockMessages = (
  messages: readonly MessageSummary[],
  query: MessageListQuery,
): MessagePage => {
  const matching = messages
    .filter((message) => message.mailboxIds.includes(query.mailboxId))
    .filter((message) => matchesSearch(message, query.search))
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
