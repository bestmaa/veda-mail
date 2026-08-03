import { describe, expect, it, vi } from "vitest";

import type { ConversationPage } from "@/domain/mail/conversation";
import { id } from "@/domain/shared/brand";
import { createConversationViewModel } from "@/presentation/features/mail-workspace/conversation.view-model";

const page = (): ConversationPage => ({
  anchorMessageId: id.message("message-b"),
  items: [
    {
      from: [{ email: "ada@example.com", name: "Ada" }],
      hasAttachment: false,
      id: id.message("message-a"),
      isStarred: false,
      isUnread: false,
      labelIds: [],
      mailboxIds: [id.mailbox("inbox")],
      preview: "Earlier reply",
      receivedAt: "2026-08-03T10:00:00.000Z",
      size: 100,
      subject: "Project",
      threadId: id.thread("thread-a"),
      to: [],
    },
    {
      from: [{ email: "grace@example.com", name: null }],
      hasAttachment: false,
      id: id.message("message-b"),
      isStarred: false,
      isUnread: true,
      labelIds: [],
      mailboxIds: [id.mailbox("sent")],
      preview: "Latest reply",
      receivedAt: "2026-08-03T11:00:00.000Z",
      size: 120,
      subject: "Re: Project",
      threadId: id.thread("thread-a"),
      to: [],
    },
  ],
  nextCursor: "next",
  strategy: "references",
  total: 3,
  truncated: false,
});

describe("conversation view model", () => {
  it("maps bounded provider results and opens the exact scoped message", () => {
    const onOpen = vi.fn();
    const onLoadMore = vi.fn();
    const model = createConversationViewModel({
      error: null,
      isLoading: false,
      isLoadingMore: false,
      onLoadMore,
      onOpen,
      page: page(),
      selectedMessageId: id.message("message-b"),
    });

    expect(model.strategyLabel).toBe("Matched by reply headers");
    expect(model.items.map(({ isActive }) => isActive)).toEqual([false, true]);
    model.items[0]?.onOpen();
    model.loadMore?.();
    expect(onOpen).toHaveBeenCalledWith("message-a");
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it("does not expose a load action without a server cursor", () => {
    const current = page();
    const model = createConversationViewModel({
      error: null,
      isLoading: false,
      isLoadingMore: false,
      onLoadMore: vi.fn(),
      onOpen: vi.fn(),
      page: { ...current, nextCursor: null, strategy: "native" },
      selectedMessageId: id.message("message-a"),
    });

    expect(model.loadMore).toBeNull();
    expect(model.strategyLabel).toBe("Provider thread");
  });
});
