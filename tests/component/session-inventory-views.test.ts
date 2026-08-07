import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AdminSessionsView } from "@/presentation/features/admin-security/ui/admin-sessions.view";
import { MemberSessionsView } from "@/presentation/features/mail-workspace/ui/member-sessions.view";

const session = {
  clientLabel: "Chrome on Windows",
  createdAt: "2026-08-06T10:00:00.000Z",
  current: true,
  expiresAt: "2026-08-06T10:30:00.000Z",
  id: "opaque-management-handle",
  lastSeenAt: "2026-08-06T10:00:00.000Z",
};

describe("session inventory views", () => {
  it("renders admin/member inventories with explicit revoke controls", () => {
    const html = renderToStaticMarkup(createElement(AdminSessionsView, { model: {
      error: null,
      isLoading: false,
      isRevoking: null,
      onRevoke: vi.fn(),
      snapshot: { administrator: [session], member: [session] },
    } }));

    expect(html).toContain("Active sessions");
    expect(html).toContain("This administrator session");
    expect(html.match(/aria-label="Revoke/g)).toHaveLength(2);
    expect(html).toContain("cannot be used to sign in");
  });

  it("explains member idle/absolute policy without exposing management IDs", () => {
    const html = renderToStaticMarkup(createElement(MemberSessionsView, { sessions: {
      error: null,
      isLoading: false,
      isRevoking: null,
      onRevoke: vi.fn(),
      snapshot: {
        policy: { absoluteTtlSeconds: 43_200, idleTtlSeconds: 1_800 },
        sessions: [session],
      },
    } }));

    expect(html).toContain("Chrome on Windows · This browser");
    expect(html).toContain("30 minutes idle");
    expect(html).toContain("12 hours");
    expect(html).not.toContain("opaque-management-handle");
  });
});
