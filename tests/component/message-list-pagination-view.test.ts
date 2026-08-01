import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { id } from "@/domain/shared/brand";
import { MessageListView } from "@/presentation/features/mail-workspace/ui/message-list.view";

const props = {
  activeFolder: "Inbox",
  activeRole: "inbox" as const,
  bulkActions: {
    allLoadedSelected: false,
    canArchive: true,
    canDestroy: false,
    canRestore: false,
    canSpam: true,
    canStop: false,
    canTrash: true,
    destroyConfirmation: {
      count: 0,
      isOpen: false,
      onCancel: vi.fn(),
      onConfirm: vi.fn(),
    },
    error: null,
    isBusy: false,
    labels: [],
    moveTargets: [],
    onArchive: vi.fn(),
    onApplyLabel: vi.fn(),
    onClear: vi.fn(),
    onMarkRead: vi.fn(),
    onMarkUnread: vi.fn(),
    onMove: vi.fn(),
    onRequestDestroy: vi.fn(),
    onRemoveLabel: vi.fn(),
    onRestore: vi.fn(),
    onSpam: vi.fn(),
    onStar: vi.fn(),
    onStop: vi.fn(),
    onToggleAllLoaded: vi.fn(),
    onTrash: vi.fn(),
    onUnstar: vi.fn(),
    restoreLabel: "Restore selected messages from Trash to Inbox",
    selectedCount: 0,
    spamLabel: "Move selected messages to Spam",
    status: "",
  },
  error: null,
  hasMore: true,
  isLoading: false,
  isLoadingMore: false,
  loadMoreError: null,
  mailboxLifecycle: {
    confirmation: {
      description: "",
      isOpen: false,
      onCancel: vi.fn(),
      onConfirm: vi.fn(),
      title: "",
    },
    disabledReason: null,
    emptyLabel: "Empty Trash",
    error: null,
    isBusy: false,
    onRequestEmpty: vi.fn(),
    retentionHint: "",
    role: null,
    status: "",
  },
  messages: [
    {
      avatar: "S",
      canDrag: true,
      canSelect: true,
      date: "Today",
      hasAttachment: false,
      id: "message-a",
      isActive: true,
      isSelected: false,
      isSelectionDisabled: false,
      isStarred: false,
      isUnread: false,
      labels: [],
      onDragEnd: vi.fn(),
      onDragStart: vi.fn(),
      onRequestMove: vi.fn(),
      onSelect: vi.fn(),
      onToggleSelected: vi.fn(),
      openLabel: "Open Example message",
      preview: "Preview",
      sender: "Sender",
      selectLabel: "Select Example message",
      subject: "Example message",
    },
  ],
  moveAnnouncement: "",
  onLoadMore: vi.fn(),
  preferences: {
    announcement: "",
    density: "comfortable" as const,
    dialog: {
      density: "comfortable" as const,
      error: null,
      isDirty: false,
      isOpen: false,
      isSaving: false,
      onClose: vi.fn(),
      onDensityChange: vi.fn(),
      onPreviewChange: vi.fn(),
      onSortChange: vi.fn(),
      onSubmit: vi.fn(),
      showPreview: true,
      sort: "newest" as const,
    },
    onOpen: vi.fn(),
    showPreview: true,
    sort: "newest" as const,
  },
  total: 2,
} as const;

describe("message list pagination view", () => {
  it("offers an accessible cursor pagination control", () => {
    const html = renderToStaticMarkup(createElement(MessageListView, props));

    expect(html).toContain("Load more messages");
    expect(html).toContain('aria-busy="false"');
    expect(html).toContain("Drag a message to a mailbox");
    expect(html).toContain('draggable="true"');
    expect(html).toContain('aria-label="Move Example message"');
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

  it("renders catalog names instead of opaque provider keywords", () => {
    const html = renderToStaticMarkup(createElement(MessageListView, {
      ...props,
      messages: [{
        ...props.messages[0],
        labels: [{
          color: "#4f46e5" as const,
          id: id.label("veda-label-aaaqeayeaudaocajbifqydiob4"),
          name: "Clients",
        }],
      }],
    }));

    expect(html).toContain('aria-label="Message labels"');
    expect(html).toContain("Clients");
    expect(html).not.toContain("veda-label-aaaqeayeaudaocajbifqydiob4");
  });

  it("applies density and removes hidden preview content from the DOM", () => {
    const html = renderToStaticMarkup(createElement(MessageListView, {
      ...props,
      preferences: {
        ...props.preferences,
        density: "compact",
        showPreview: false,
      },
    }));

    expect(html).toContain('data-density="compact"');
    expect(html).toContain("min-h-11 p-2");
    expect(html).not.toContain(">Preview<");
    expect(html).toContain("Message list options");
  });

  it("visibly announces optimistic progress and marks pending rows busy", () => {
    const html = renderToStaticMarkup(createElement(MessageListView, {
      ...props,
      bulkActions: {
        ...props.bulkActions,
        isBusy: true,
        status: "Updating 1 message…",
      },
      messages: [{ ...props.messages[0], isPending: true }],
    }));

    expect(html).toContain('role="status"');
    expect(html).toContain("Updating 1 message…");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("opacity-60");
  });

  it("offers stopping after the active provider batch", () => {
    const html = renderToStaticMarkup(createElement(MessageListView, {
      ...props,
      bulkActions: {
        ...props.bulkActions,
        canStop: true,
        isBusy: true,
        selectedCount: 101,
      },
    }));

    expect(html).toContain('aria-label="Stop after current batch"');
    expect(html).toMatch(
      /aria-label="Stop after current batch" class="[^"]+" title=/,
    );
  });
});
