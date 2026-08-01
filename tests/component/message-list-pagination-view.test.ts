import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MessageListView } from "@/presentation/features/mail-workspace/ui/message-list.view";

const props = {
  activeFolder: "Inbox",
  error: null,
  hasMore: true,
  isLoading: false,
  isLoadingMore: false,
  loadMoreError: null,
  messages: [
    {
      avatar: "S",
      date: "Today",
      hasAttachment: false,
      id: "message-a",
      isActive: true,
      isStarred: false,
      isUnread: false,
      onSelect: vi.fn(),
      openLabel: "Open Example message",
      preview: "Preview",
      sender: "Sender",
      subject: "Example message",
    },
  ],
  onLoadMore: vi.fn(),
  total: 2,
} as const;

describe("message list pagination view", () => {
  it("offers an accessible cursor pagination control", () => {
    const html = renderToStaticMarkup(createElement(MessageListView, props));

    expect(html).toContain("Load more messages");
    expect(html).toContain('aria-busy="false"');
    expect(html).not.toContain('role="alert"');
  });

  it("locks duplicate loads and announces a recoverable page error", () => {
    const loading = renderToStaticMarkup(
      createElement(MessageListView, { ...props, isLoadingMore: true }),
    );
    const failed = renderToStaticMarkup(
      createElement(MessageListView, {
        ...props,
        loadMoreError: "Provider timed out.",
      }),
    );

    expect(loading).toContain("Loading more messages…");
    expect(loading).toContain('disabled=""');
    expect(loading).toContain('aria-busy="true"');
    expect(failed).toContain('role="alert"');
    expect(failed).toContain(
      "Provider timed out. Select Load more messages to retry.",
    );
  });

  it("does not render pagination after the final page", () => {
    const html = renderToStaticMarkup(
      createElement(MessageListView, { ...props, hasMore: false }),
    );

    expect(html).not.toContain("Load more messages");
  });
});
