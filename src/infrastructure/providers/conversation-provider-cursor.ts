import "server-only";

import { createHash } from "node:crypto";

import {
  CONVERSATION_PAGE_SIZE,
  MAX_CONVERSATION_MESSAGES,
  type ConversationQuery,
} from "@/domain/mail/conversation";

const SNAPSHOT_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export interface ConversationProviderPosition {
  readonly offset: number;
  readonly snapshot: string | null;
}

export const conversationProviderPosition = (
  query: ConversationQuery,
): ConversationProviderPosition => {
  if (query.limit !== CONVERSATION_PAGE_SIZE) {
    throw new Error("Invalid conversation page size.");
  }
  if (!query.cursor) return { offset: 0, snapshot: null };
  const [encodedOffset, snapshot, extra] = query.cursor.split(".");
  if (
    !encodedOffset || !snapshot || extra ||
    !/^[1-9]\d{0,2}$/u.test(encodedOffset) ||
    !SNAPSHOT_PATTERN.test(snapshot)
  ) throw new Error("Invalid conversation cursor.");
  const offset = Number(encodedOffset);
  if (!Number.isSafeInteger(offset) || offset >= MAX_CONVERSATION_MESSAGES) {
    throw new Error("Invalid conversation cursor.");
  }
  return { offset, snapshot };
};

export const conversationSnapshot = (
  messages: readonly { readonly id: string; readonly receivedAt: string }[],
): string => {
  const hash = createHash("sha256");
  hash.update("veda-mail/conversation-snapshot/v1\0");
  for (const message of messages) {
    hash.update(String(message.id.length)).update(":").update(message.id);
    hash.update(String(message.receivedAt.length)).update(":")
      .update(message.receivedAt);
  }
  return hash.digest("base64url");
};

export const assertConversationSnapshot = (
  expected: string | null,
  actual: string,
): void => {
  if (expected && expected !== actual) {
    throw new Error("The conversation changed. Reopen it and try again.");
  }
};

export const nextConversationProviderCursor = (
  nextOffset: number,
  total: number,
  snapshot: string,
): string | null => nextOffset < total ? `${nextOffset}.${snapshot}` : null;
