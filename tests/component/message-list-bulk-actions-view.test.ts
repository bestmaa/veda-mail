import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { BulkActionsViewModel } from "@/presentation/features/mail-workspace/bulk-actions.view-model";
import { BulkActionsToolbarView } from "@/presentation/features/mail-workspace/ui/bulk-actions-toolbar.view";

const bulk = (overrides: Partial<BulkActionsViewModel> = {}) => ({
  allLoadedSelected: false,
  canArchive: true,
  canDestroy: false,
  canExport: true,
  canRestore: false,
  canSpam: true,
  canStop: false,
  canTrash: true,
  destroyConfirmation: {
    count: 2,
    isOpen: false,
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
  },
  error: null,
  isBusy: false,
  labels: [],
  moveTargets: [{ id: "archive", label: "Archive" }],
  onArchive: vi.fn(),
  onApplyLabel: vi.fn(),
  onClear: vi.fn(),
  onExport: vi.fn(),
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
  selectedCount: 2,
  spamLabel: "Move selected messages to Spam",
  status: "",
  ...overrides,
});

describe("message list bulk action toolbar", () => {
  it("renders the complete accessible action set for selected messages", () => {
    const html = renderToStaticMarkup(
      createElement(BulkActionsToolbarView, { bulk: bulk() }),
    );

    expect(html).toContain('role="toolbar"');
    expect(html).toContain('aria-label="Bulk message actions"');
    expect(html).toContain('aria-label="Mark selected messages as read"');
    expect(html).toContain('aria-label="Mark selected messages as unread"');
    expect(html).toContain('aria-label="Star selected messages"');
    expect(html).toContain('aria-label="Archive selected messages"');
    expect(html).toContain('aria-label="Export selected messages as EML files"');
    expect(html).toContain('aria-label="Move selected messages to Spam"');
    expect(html).toContain('aria-label="Move selected messages"');
    expect(html).toContain("2 selected");
  });

  it("uses dedicated Not spam and Trash restore labels", () => {
    const spam = renderToStaticMarkup(createElement(BulkActionsToolbarView, {
      bulk: bulk({
        canArchive: false,
        canRestore: true,
        canSpam: false,
        canTrash: false,
        restoreLabel: "Mark selected messages as not spam",
      }),
    }));
    const trash = renderToStaticMarkup(createElement(BulkActionsToolbarView, {
      bulk: bulk({
        canArchive: false,
        canRestore: true,
        canSpam: false,
        canTrash: false,
      }),
    }));

    expect(spam).toContain('aria-label="Mark selected messages as not spam"');
    expect(spam).not.toContain("Move selected messages to Spam");
    expect(trash).toContain(
      'aria-label="Restore selected messages from Trash to Inbox"',
    );
  });

  it("locks every mutation control while a batch is in flight", () => {
    const html = renderToStaticMarkup(
      createElement(BulkActionsToolbarView, {
        bulk: bulk({ isBusy: true }),
      }),
    );

    expect(html).toContain('aria-busy="true"');
    expect(html.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(9);
  });

  it("offers provider-portable label apply and remove controls", () => {
    const html = renderToStaticMarkup(createElement(BulkActionsToolbarView, {
      bulk: bulk({
        labels: [{ color: "#4f46e5", id: "veda-label-aaaqeayeaudaocajbifqydiob4", name: "Clients" }],
      }),
    }));

    expect(html).toContain('aria-label="Apply label…"');
    expect(html).toContain('aria-label="Remove label…"');
    expect(html).toContain("Clients");
  });

  it("does not occupy the mailbox when no messages are selected", () => {
    const html = renderToStaticMarkup(
      createElement(BulkActionsToolbarView, {
        bulk: bulk({ selectedCount: 0 }),
      }),
    );

    expect(html).toBe("");
  });
});
