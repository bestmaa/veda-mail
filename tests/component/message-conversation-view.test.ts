import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ConversationViewModel } from "@/presentation/features/mail-workspace/conversation.view-model";
import { MessageConversationView } from "@/presentation/features/mail-workspace/ui/message-conversation.view";

const conversation = (): ConversationViewModel => ({
  error: null,
  isLoading: false,
  isLoadingMore: false,
  items: [
    {
      avatar: "A",
      date: "10:00 am",
      id: "message-a",
      isActive: false,
      isUnread: false,
      onOpen: vi.fn(),
      preview: "Earlier",
      sender: "Ada",
      subject: "Project",
    },
    {
      avatar: "G",
      date: "11:00 am",
      id: "message-b",
      isActive: true,
      isUnread: true,
      onOpen: vi.fn(),
      preview: "Latest",
      sender: "Grace",
      subject: "Re: Project",
    },
  ],
  loadMore: vi.fn(),
  strategyLabel: "Provider thread",
  total: 3,
  truncated: false,
});

describe("message conversation view", () => {
  it("renders an accessible ordered thread navigator and active message", () => {
    const html = renderToStaticMarkup(createElement(MessageConversationView, {
      conversation: conversation(),
    }));

    expect(html).toContain('aria-label="Conversation"');
    expect(html).toContain('aria-current="true"');
    expect(html).toContain("Load more messages");
    expect(html).toContain("Provider thread");
  });

  it("hides a successful single-message conversation", () => {
    const current = conversation();
    const html = renderToStaticMarkup(createElement(MessageConversationView, {
      conversation: { ...current, items: [current.items[0]!], loadMore: null, total: 1 },
    }));
    expect(html).toBe("");
  });

  it("announces provider failures without discarding the open message", () => {
    const current = conversation();
    const html = renderToStaticMarkup(createElement(MessageConversationView, {
      conversation: { ...current, error: "Unable to load this conversation.", items: [] },
    }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("Unable to load this conversation.");
  });
});
