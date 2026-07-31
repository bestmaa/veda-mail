import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MemberSignOutConfirmationView } from "@/presentation/features/mail-workspace/ui/member-sign-out-confirmation.view";

const session = (isOpen: boolean, isSigningOut = false) => ({
  canSignOut: true,
  confirmation: { isOpen, onCancel: vi.fn(), onConfirm: vi.fn() },
  isSigningOut,
  onSignOut: vi.fn(),
  privacyCurtain: {
    error: null, isOpen: false, isPurging: false,
    onRetryCleanup: vi.fn(),
  },
});

describe("member sign-out confirmation", () => {
  it("warns that recovery is removed before a confirmed sign-out", () => {
    const html = renderToStaticMarkup(createElement(
      MemberSignOutConfirmationView, { session: session(true) },
    ));
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('id="member-sign-out-confirmation-dialog"');
    expect(html).toContain('id="member-sign-out-confirmation-cancel"');
    expect(html).toContain('id="member-sign-out-confirmation-confirm"');
    expect(html).not.toContain("autofocus");
    expect(html).toContain("Sign out everywhere in this session?");
    expect(html).toContain("every open Veda Mail tab");
    expect(html).toContain("attempts to permanently remove");
    expect(html).toContain("keeps the mailbox hidden");
    expect(html).toContain("browser-local draft recovery");
    expect(html).toContain("interrupted send or discard marker");
    expect(html).toContain("Check Sent");
    expect(html).toContain("Keep editing");
    expect(html).toContain("Sign out everywhere");
  });

  it("renders nothing while closed and locks actions during purge", () => {
    expect(renderToStaticMarkup(createElement(
      MemberSignOutConfirmationView, { session: session(false) },
    ))).toBe("");
    const html = renderToStaticMarkup(createElement(
      MemberSignOutConfirmationView, { session: session(true, true) },
    ));
    expect(html).toContain("Signing out…");
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });
});
