import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MemberSessionPrivacyCurtainView } from "@/presentation/features/mail-workspace/ui/member-session-privacy-curtain.view";
import { MailWorkspaceView } from "@/presentation/features/mail-workspace/ui/mail-workspace.view";
import type { MailWorkspaceViewProps } from "@/presentation/features/mail-workspace/mail-workspace.view-model";

const privacy = (
  isOpen: boolean,
  isPurging: boolean,
  error: string | null = null,
) => ({
  error,
  isOpen,
  isPurging,
  onRetryCleanup: vi.fn(),
});

describe("member session privacy curtain", () => {
  it("hides itself before the server confirms sign out", () => {
    const html = renderToStaticMarkup(createElement(
      MemberSessionPrivacyCurtainView,
      { privacy: privacy(false, false) },
    ));

    expect(html).toBe("");
  });

  it("blocks the workspace while exact-scope cleanup is running", () => {
    const html = renderToStaticMarkup(createElement(
      MemberSessionPrivacyCurtainView,
      { privacy: privacy(true, true) },
    ));

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Finishing secure session cleanup");
    expect(html).toContain("Your mailbox is hidden");
    expect(html).not.toContain("Retry secure cleanup");
  });

  it("keeps content hidden and offers cleanup retry after failure", () => {
    const html = renderToStaticMarkup(createElement(
      MemberSessionPrivacyCurtainView,
      { privacy: privacy(true, false, "Cleanup failed securely.") },
    ));

    expect(html).toContain('role="alert"');
    expect(html).toContain("Mailbox session ended");
    expect(html).toContain("Cleanup failed securely.");
    expect(html).toContain("Retry secure cleanup");
    expect(html).toContain("autofocus");
  });

  it("removes cached mailbox children from the DOM while curtained", () => {
    const props = {
      account: { name: "PRIVATE MAILBOX CONTENT" },
      session: { privacyCurtain: privacy(true, false, "Cleanup failed.") },
    } as unknown as MailWorkspaceViewProps;
    const html = renderToStaticMarkup(createElement(MailWorkspaceView, props));

    expect(html).toContain("Mailbox session ended");
    expect(html).not.toContain("PRIVATE MAILBOX CONTENT");
    expect(html).not.toContain("Compose a new message");
  });
});
