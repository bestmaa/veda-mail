import { afterEach, describe, expect, it, vi } from "vitest";

import { adminMailUsersApi } from "@/transport/client/admin-mail-users-api";

const user = {
  aliases: ["alias@example.com"],
  createdAt: "2026-07-31T10:00:00.000Z",
  displayName: "Ada Lovelace",
  email: "ada@example.com",
  id: "account:ada",
  locale: "en",
  maxDiskQuota: 10_000,
  timeZone: "Asia/Calcutta",
  usedDiskQuota: 1_000,
};

afterEach(() => vi.unstubAllGlobals());

describe("admin mailbox users transport client", () => {
  it("encodes list filters and bypasses browser caches", async () => {
    const snapshot = {
      adminTwoFactorEnabled: false,
      allowedDomains: ["example.com"],
      creation: { available: true, reason: null },
      nextCursor: null,
      status: "available",
      users: [user],
    };
    const fetch = vi.fn(async () => Response.json({ data: snapshot }));
    vi.stubGlobal("fetch", fetch);

    await adminMailUsersApi.getSnapshot({
      cursor: "next/page",
      domain: "example.com",
      search: "Ada & team",
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/admin/users?cursor=next%2Fpage&domain=example.com&search=Ada+%26+team",
      { cache: "no-store", headers: {} },
    );
  });

  it("encodes opaque detail IDs and forwards cancellation", async () => {
    const fetch = vi.fn(async () => Response.json({ data: { user } }));
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;

    await adminMailUsersApi.getDetail(
      "person/id?one",
      "example.com",
      signal,
    );

    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/admin/users/person%2Fid%3Fone?domain=example.com",
      { cache: "no-store", headers: {}, signal },
    );
  });

  it("sends creation secrets only in the body with an idempotency key", async () => {
    const fetch = vi.fn<
      (input: string, init?: RequestInit) => Promise<Response>
    >(async () => Response.json({ data: { user } }));
    vi.stubGlobal("fetch", fetch);
    const input = {
      confirmPassword: "MailboxPassword9",
      currentAdminPassword: "AdminPassword9",
      email: "ada@example.com",
      password: "MailboxPassword9",
    };

    await adminMailUsersApi.create(
      input,
      "11111111-1111-4111-8111-111111111111",
    );

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("/api/v1/admin/users");
    expect(init).toMatchObject({
      body: JSON.stringify(input),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "11111111-1111-4111-8111-111111111111",
      },
      method: "POST",
    });
    expect(String(url)).not.toContain("Password");
  });
});
