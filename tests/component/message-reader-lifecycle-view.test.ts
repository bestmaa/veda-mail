import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ReaderViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";
import { MessageReaderToolbarView } from "@/presentation/features/mail-workspace/ui/message-reader-toolbar.view";
import { ReaderDestroyConfirmationView } from "@/presentation/features/mail-workspace/ui/reader-destroy-confirmation.view";

const reader = {
  canArchive: false,
  isLoading: false,
  isStarred: false,
  isUnread: false,
  labelActions: null,
  messageId: "message-a",
  print: {
    canPrintConversation: false, document: null, error: null,
    isPreparing: false, locale: "en-IN", onPrintConversation: vi.fn(),
    onPrintMessage: vi.fn(), onPrinted: vi.fn(), timeZone: "Asia/Kolkata",
  },
} as unknown as ReaderViewModel;
const toolbar = (activeRole: "inbox" | "spam" | "trash") =>
  renderToStaticMarkup(createElement(MessageReaderToolbarView, {
    activeRole,
    canPermanentlyDelete: true,
    isBusy: false,
    onArchive: vi.fn(),
    onClose: vi.fn(),
    onDelete: vi.fn(),
    onRequestDestroy: vi.fn(),
    onRequestMove: vi.fn(),
    onRestore: vi.fn(),
    onToggleRead: vi.fn(),
    onToggleStar: vi.fn(),
    reader,
  }));

describe("message reader lifecycle actions", () => {
  it("offers Not spam and permanent delete only inside Spam", () => {
    const html = toolbar("spam");

    expect(html).toContain('aria-label="Mark as not spam"');
    expect(html).toContain('aria-label="Permanently delete"');
    expect(html).not.toContain('aria-label="Delete"');
  });

  it("offers Trash restore and permanent delete inside Trash", () => {
    const html = toolbar("trash");

    expect(html).toContain('aria-label="Restore to Inbox"');
    expect(html).toContain('aria-label="Permanently delete"');
  });

  it("keeps ordinary folders on recoverable Delete", () => {
    const html = toolbar("inbox");

    expect(html).toContain('aria-label="Delete"');
    expect(html).toContain('aria-label="Move message"');
    expect(html).not.toContain("Permanently delete");
    expect(html).not.toContain("Restore to Inbox");
  });

  it("keeps Move disabled until the reader detail is authoritative", () => {
    const html = renderToStaticMarkup(createElement(MessageReaderToolbarView, {
      activeRole: "inbox", canPermanentlyDelete: false, isBusy: false,
      onArchive: vi.fn(), onClose: vi.fn(), onDelete: vi.fn(),
      onRequestDestroy: vi.fn(), onRequestMove: vi.fn(), onRestore: vi.fn(),
      onToggleRead: vi.fn(), onToggleStar: vi.fn(),
      reader: { ...reader, isLoading: true, messageId: "" },
    }));

    expect(html).toContain('aria-label="Move message"');
    expect(html).toContain('disabled=""');
  });

  it("disables permanent delete without provider removal rights", () => {
    const html = renderToStaticMarkup(createElement(MessageReaderToolbarView, {
      activeRole: "trash",
      canPermanentlyDelete: false,
      isBusy: false,
      onArchive: vi.fn(), onClose: vi.fn(), onDelete: vi.fn(),
      onRequestDestroy: vi.fn(), onRequestMove: vi.fn(), onRestore: vi.fn(), onToggleRead: vi.fn(),
      onToggleStar: vi.fn(), reader,
    }));

    expect(html).toContain("provider permission required");
    expect(html).toContain('disabled=""');
  });

  it("requires a named irreversible confirmation with Cancel first", () => {
    const html = renderToStaticMarkup(createElement(
      ReaderDestroyConfirmationView,
      { confirmation: {
        isOpen: true,
        onCancel: vi.fn(),
        onConfirm: vi.fn(),
      } },
    ));

    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html.indexOf(">Cancel<")).toBeLessThan(
      html.indexOf(">Permanently delete<"),
    );
  });
});
