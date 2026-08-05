import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertRequestRateLimit: vi.fn(),
  assertSubjectRateLimit: vi.fn(),
  getCurrentConnection: vi.fn(),
  waitForMailUpdate: vi.fn(),
}));

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.getCurrentConnection,
}));
vi.mock("@/server/mail/mail-update-wait", () => ({
  waitForMailUpdate: mocks.waitForMailUpdate,
}));
vi.mock("@/server/security/rate-limit", () => ({
  assertRequestRateLimit: mocks.assertRequestRateLimit,
  assertSubjectRateLimit: mocks.assertSubjectRateLimit,
}));

import { GET } from "@/app/api/v1/mail/updates/route";
import type { ProviderConnection } from "@/domain/provider/provider";
import { id } from "@/domain/shared/brand";
import { mailSessionScope } from "@/server/connections/mail-session-scope";

const connection: ProviderConnection = {
  config: {},
  createdAt: "2026-08-05T00:00:00.000Z",
  displayName: "Mailbox",
  id: id.connection("updates-route"),
  providerId: id.provider("mock"),
};

const request = (scope = mailSessionScope(connection)) => new Request(
  "https://mail.example.com/api/v1/mail/updates",
  { headers: { "x-veda-mail-session-scope": scope } },
);

beforeEach(() => {
  mocks.assertRequestRateLimit.mockReset();
  mocks.assertSubjectRateLimit.mockReset();
  mocks.getCurrentConnection.mockReset().mockResolvedValue(connection);
  mocks.waitForMailUpdate.mockReset().mockResolvedValue({
    mode: "push", retryAfterMs: 1_000, shouldRefresh: true,
  });
});

describe("mail updates route", () => {
  it("returns a scoped provider update result without caching", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      data: { mode: "push", retryAfterMs: 1_000, shouldRefresh: true },
    });
    expect(mocks.waitForMailUpdate).toHaveBeenCalledWith(connection);
  });

  it("rejects a stale account scope before opening a provider wait", async () => {
    const response = await GET(request("different-account"));

    expect(response.status).toBe(409);
    expect(mocks.waitForMailUpdate).not.toHaveBeenCalled();
  });
});
