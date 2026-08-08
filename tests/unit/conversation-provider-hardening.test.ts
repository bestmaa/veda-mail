import type { FetchMessageObject } from "imapflow";
import { describe, expect, it, vi } from "vitest";

import { CONVERSATION_PAGE_SIZE } from "@/domain/mail/conversation";
import { id } from "@/domain/shared/brand";
import {
  assertConversationSnapshot,
  conversationProviderPosition,
  conversationSnapshot,
  nextConversationProviderCursor,
} from "@/infrastructure/providers/conversation-provider-cursor";
import {
  conversationFetchQuery,
  fetchAnchorSequenceWindow,
  graphNode,
} from "@/infrastructure/providers/imap-smtp/imap-conversation-helpers";

describe("conversation provider hardening", () => {
  it("partially fetches reply headers and marks an oversized literal", () => {
    const message = {
      envelope: { messageId: "<anchor@example.com>" },
      headers: Buffer.from(`References: ${"x".repeat(65_536)}`),
    } as FetchMessageObject;

    expect(conversationFetchQuery).toMatchObject({
      source: { maxLength: 65_540 },
    });
    expect(conversationFetchQuery).not.toHaveProperty("bodyParts");
    expect(graphNode(message).truncated).toBe(true);
  });

  it("binds later offsets to the exact ordered membership snapshot", () => {
    const messages = [{ id: "one", receivedAt: "2026-08-03T00:00:00Z" }];
    const snapshot = conversationSnapshot(messages);
    const cursor = nextConversationProviderCursor(25, 30, snapshot);
    if (!cursor) throw new Error("Expected a later-page cursor.");
    const position = conversationProviderPosition({
      anchorMessageId: id.message("anchor"),
      cursor,
      limit: CONVERSATION_PAGE_SIZE,
    });

    expect(position).toEqual({ offset: 25, snapshot });
    expect(() => assertConversationSnapshot(position.snapshot,
      conversationSnapshot([{ ...messages[0]!, receivedAt: "changed" }])))
      .toThrow("conversation changed");
  });

  it("never scans more sequence entries than the shared conversation budget", async () => {
    const fetchAll = vi.fn().mockResolvedValue([]);
    const fetchBudget = { remaining: 99 };

    const result = await fetchAnchorSequenceWindow({ fetchAll } as never, {
      anchorSequence: 500, exists: 1_000, fetchBudget,
    });

    expect(fetchAll).toHaveBeenCalledWith(
      "451:549", expect.objectContaining({ source: { maxLength: 65_540 } }),
    );
    expect(fetchBudget.remaining).toBe(0);
    expect(result).toEqual({ messages: [], truncated: true });
  });
});
