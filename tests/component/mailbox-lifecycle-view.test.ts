import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { MailboxLifecycleViewModel } from "@/presentation/features/mail-workspace/mailbox-lifecycle.view-model";
import { MailboxEmptyConfirmationView } from "@/presentation/features/mail-workspace/ui/mailbox-empty-confirmation.view";
import { MailboxLifecycleBannerView } from "@/presentation/features/mail-workspace/ui/mailbox-lifecycle-banner.view";

const lifecycle = (
  overrides: Partial<MailboxLifecycleViewModel> = {},
): MailboxLifecycleViewModel => ({
  confirmation: {
    description: "All messages currently in Trash will be removed. This cannot be undone.",
    isOpen: false,
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
    title: "Empty Trash permanently?",
  },
  disabledReason: null,
  emptyLabel: "Empty Trash",
  error: null,
  isBusy: false,
  onRequestEmpty: vi.fn(),
  retentionHint:
    "Your mail provider may remove messages according to its retention policy.",
  role: "trash",
  status: "",
  ...overrides,
});

describe("mailbox lifecycle views", () => {
  it("renders a role-specific portable retention banner", () => {
    const html = renderToStaticMarkup(createElement(
      MailboxLifecycleBannerView,
      { lifecycle: lifecycle() },
    ));

    expect(html).toContain('aria-label="Trash lifecycle"');
    expect(html).toContain("Deleted messages");
    expect(html).toContain("retention policy");
    expect(html).toContain("Empty Trash");
  });

  it("explains and disables emptying while search is active", () => {
    const html = renderToStaticMarkup(createElement(
      MailboxLifecycleBannerView,
      { lifecycle: lifecycle({
        disabledReason: "Clear the active search before emptying Trash.",
      }) },
    ));

    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-describedby="mailbox-empty-disabled-reason"');
    expect(html).toContain("Clear the active search");
  });

  it("announces cleanup progress and errors", () => {
    const html = renderToStaticMarkup(createElement(
      MailboxLifecycleBannerView,
      { lifecycle: lifecycle({
        error: "Cleanup paused.",
        status: "98 messages permanently deleted.",
      }) },
    ));

    expect(html).toContain('role="status"');
    expect(html).toContain('role="alert"');
  });

  it("renders a named irreversible alert dialog with safe Cancel first", () => {
    const html = renderToStaticMarkup(createElement(
      MailboxEmptyConfirmationView,
      { lifecycle: lifecycle({
        confirmation: {
          ...lifecycle().confirmation,
          isOpen: true,
        },
      }) },
    ));

    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html.indexOf(">Cancel<")).toBeLessThan(
      html.indexOf(">Empty Trash permanently<"),
    );
  });
});
