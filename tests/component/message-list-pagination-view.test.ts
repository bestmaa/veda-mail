import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MessageListView } from "@/presentation/features/mail-workspace/ui/message-list.view";

const props = {
  activeFolder: "Inbox",
  bulkActions: {
    allLoadedSelected: false,
    canArchive: true,
    canDestroy: false,
    canRestore: false,
    canSpam: true,
    canTrash: true,
    destroyConfirmation: {
      count: 0,
      isOpen: false,
      onCancel: vi.fn(),
      onConfirm: vi.fn(),
    },
    error: null,
    isBusy: false,
    moveTargets: [],
    onArchive: vi.fn(),
    onClear: vi.fn(),
    onMarkRead: vi.fn(),
    onMarkUnread: vi.fn(),
    onMove: vi.fn(),
    onRequestDestroy: vi.fn(),
    onRestore: vi.fn(),
    onSpam: vi.fn(),
    onStar: vi.fn(),
    onToggleAllLoaded: vi.fn(),
    onTrash: vi.fn(),
    onUnstar: vi.fn(),
    selectedCount: 0,
    status: "",
  },
  error: null,
  hasMore: true,
  isLoading: false,
  isLoadingMore: false,
  loadMoreError: null,
  messages: [
    {
      avatar: "S",
      canSelect: true,
      date: "Today",
      hasAttachment: false,
      id: "message-a",
      isActive: true,
      isSelected: false,
      isSelectionDisabled: false,
      isStarred: false,
      isUnread: false,
      onSelect: vi.fn(),
      onToggleSelected: vi.fn(),
      openLabel: "Open Example message",
      preview: "Preview",
      sender: "Sender",
      selectLabel: "Select Example message",
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
