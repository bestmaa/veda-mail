import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/transport/http/api-error";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  getUser: vi.fn(),
  requestRate: vi.fn(),
  subjectRate: vi.fn(),
}));

vi.mock("@/server/auth/admin-session", () => ({
  assertAdminAccess: mocks.assertAccess,
}));
vi.mock("@/server/mail-users/mail-user-administration", () => ({
  getAdminMailUser: mocks.getUser,
}));
vi.mock("@/server/security/rate-limit", () => ({
  assertRequestRateLimit: mocks.requestRate,
  assertSubjectRateLimit: mocks.subjectRate,
}));

import { GET } from "@/app/api/v1/admin/users/[userId]/route";

const request = (query: string) =>
  new Request(`https://webmail.example.com/api/v1/admin/users/account-1${query}`);
const context = (userId = "account-1") => ({
  params: Promise.resolve({ userId }),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({
    aliases: [],
    createdAt: null,
    displayName: null,
    email: "ada@example.com",
    id: "account-1",
    locale: null,
    maxDiskQuota: null,
    timeZone: null,
    usedDiskQuota: 0,
  });
});

describe("admin mailbox user detail API", () => {
  it("requires admin access and a configured domain scope", async () => {
    mocks.assertAccess.mockRejectedValueOnce(
      new ApiError("Sign in.", "ADMIN_UNAUTHORIZED", 401),
    );
    expect((await GET(request("?domain=example.com"), context())).status).toBe(
      401,
    );
    expect((await GET(request(""), context())).status).toBe(400);
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("strictly rejects duplicate/unknown query fields and unsafe IDs", async () => {
    expect(
      (
        await GET(
          request("?domain=example.com&domain=example.org"),
          context(),
        )
      ).status,
    ).toBe(400);
    expect(
      (await GET(request("?domain=example.com&extra=1"), context())).status,
    ).toBe(400);
    expect(
      (await GET(request("?domain=example.com"), context("../admin"))).status,
    ).toBe(400);
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("returns only the safe user projection and no-store headers", async () => {
    const response = await GET(request("?domain=example.com"), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.getUser).toHaveBeenCalledWith("example.com", "account-1");
    expect(JSON.stringify(await response.json())).not.toContain("credentials");
  });

  it("preserves domain-isolation failures", async () => {
    mocks.getUser.mockRejectedValueOnce(
      new ApiError("Forbidden domain.", "MAIL_USER_DOMAIN_FORBIDDEN", 403),
    );
    const response = await GET(request("?domain=evil.example"), context());
    expect(response.status).toBe(403);
    expect(response.headers.get("x-veda-api-error-code")).toBe(
      "MAIL_USER_DOMAIN_FORBIDDEN",
    );
  });
});
