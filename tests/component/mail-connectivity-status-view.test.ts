import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MailConnectivityStatusView } from "@/presentation/features/mail-workspace/ui/mail-connectivity-status.view";
import type { MailConnectivityViewModel } from "@/presentation/features/mail-workspace/mail-connectivity";

const render = (input: Partial<MailConnectivityViewModel>) =>
  renderToStaticMarkup(createElement(MailConnectivityStatusView, {
    connectivity: { canRetry: false, isBusy: false, message: "",
      onRetry: vi.fn(), phase: null, ...input },
  }));

describe("mail connectivity status", () => {
  it("stays absent while the mailbox is current", () => {
    expect(render({})).toBe("");
  });

  it("announces offline snapshots without offering a futile retry", () => {
    const html = render({
      message: "You're offline. Mail shown below may be out of date.",
      phase: "offline",
    });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Mail shown below may be out of date");
    expect(html).not.toContain("Retry now");
  });

  it("offers one accessible retry for an online stale snapshot", () => {
    const html = render({ canRetry: true,
      message: "Mail may be out of date.", phase: "stale" });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Retry now");
    expect(html).toContain("Mail may be out of date");
  });

  it("exposes bounded reconciliation as busy status", () => {
    const html = render({ isBusy: true,
      message: "Back online. Checking for new mail…", phase: "reconnecting" });
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
  });
});
