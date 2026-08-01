import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { BulkActionsViewModel } from "@/presentation/features/mail-workspace/bulk-actions.view-model";
import { BulkActionsToolbarView } from "@/presentation/features/mail-workspace/ui/bulk-actions-toolbar.view";

const bulk = (overrides: Partial<BulkActionsViewModel> = {}) => ({
  allLoadedSelected: false,
  canArchive: true,
  canDestroy: false,
  canRestore: false,
  canSpam: true,
  canTrash: true,
  destroyConfirmation: {
    count: 2,
    isOpen: false,
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
  },
  error: null,
  isBusy: false,
  moveTargets: [{ id: "archive", label: "Archive" }],
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
  selectedCount: 2,
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
    expect(html).toContain('aria-label="Report selected messages as spam"');
    expect(html).toContain('aria-label="Move selected messages"');
    expect(html).toContain("2 selected");
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

  it("does not occupy the mailbox when no messages are selected", () => {
    const html = renderToStaticMarkup(
      createElement(BulkActionsToolbarView, {
        bulk: bulk({ selectedCount: 0 }),
      }),
    );

    expect(html).toBe("");
  });
});
