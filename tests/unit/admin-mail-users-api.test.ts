import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/transport/http/api-error";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  assertOrigin: vi.fn(),
  issueToken: vi.fn(),
  provision: vi.fn(),
  requestRate: vi.fn(),
  snapshot: vi.fn(),
  stepUp: vi.fn(),
  subjectRate: vi.fn(),
}));

vi.mock("@/server/auth/admin-session", () => ({
  ADMIN_COOKIE: "veda_mail_admin",
  ADMIN_SESSION_TTL_SECONDS: 43_200,
  adminCookieOptions: { httpOnly: true, path: "/", sameSite: "lax" },
  assertAdminAccess: mocks.assertAccess,
  issueAdminToken: mocks.issueToken,
}));
vi.mock("@/server/auth/admin-step-up", () => ({
  verifyAdminStepUp: mocks.stepUp,
}));
vi.mock("@/server/installation/request-origin", () => ({
  assertSameOrigin: mocks.assertOrigin,
}));
vi.mock("@/server/mail-users/mail-user-administration", () => ({
  getAdminMailUsersSnapshot: mocks.snapshot,
}));
vi.mock("@/server/mail-users/mail-user-provisioning", () => ({
  provisionAdminMailUser: mocks.provision,
}));
vi.mock("@/server/security/rate-limit", () => ({
  assertRequestRateLimit: mocks.requestRate,
  assertSubjectRateLimit: mocks.subjectRate,
}));

import { GET, POST } from "@/app/api/v1/admin/users/route";

const installation = {
  mailProfile: {
    allowedDomains: ["example.com"],
    config: { baseUrl: "https://mail.example.com" },
    createdAt: "2026-07-31T00:00:00.000Z",
    displayName: "Example",
    providerId: "stalwart-jmap",
    updatedAt: "2026-07-31T00:00:00.000Z",
    version: 1,
  },
  sessionSecret: "installation-secret",
};
const user = {
  aliases: [],
  createdAt: null,
  displayName: "Ada",
  email: "ada@example.com",
  id: "account-1",
  locale: null,
  maxDiskQuota: null,
  timeZone: null,
  usedDiskQuota: 0,
};

const input = {
  confirmPassword: "  Mailbox Password 123  ",
  currentAdminPassword: "Admin Password 456",
  displayName: "Ada",
  email: "ada@example.com",
  password: "  Mailbox Password 123  ",
};

const request = (
  body: unknown = input,
  headers: Record<string, string> = {},
): Request =>
  new Request("https://webmail.example.com/api/v1/admin/users", {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      host: "webmail.example.com",
      "idempotency-key": "16161616-1616-4616-8616-161616161616",
      origin: "https://webmail.example.com",
      ...headers,
    },
    method: "POST",
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.issueToken.mockResolvedValue("refreshed-token");
  mocks.stepUp.mockResolvedValue({
    installation,
    sessionRotated: false,
  });
  mocks.provision.mockResolvedValue({ outcome: "created", user });
  mocks.snapshot.mockResolvedValue({
    adminTwoFactorEnabled: false,
    allowedDomains: ["example.com"],
    creation: { available: true, reason: null },
    nextCursor: null,
    status: "available",
    users: [],
  });
});

describe("admin mailbox users API", () => {
  it("authenticates reads and returns private snapshots", async () => {
    const response = await GET(
      new Request("https://webmail.example.com/api/v1/admin/users?domain=example.com"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.snapshot).toHaveBeenCalledWith({ domain: "example.com" });

    mocks.assertAccess.mockRejectedValueOnce(
      new ApiError("Sign in.", "ADMIN_UNAUTHORIZED", 401),
    );
    expect((await GET(new Request("https://webmail.example.com/api/v1/admin/users"))).status).toBe(401);
  });

  it.each(["?domain=example.com&domain=example.org", "?extra=1", "?__proto__=polluted"])("rejects unsafe read query %s", async (query) => {
    const url = `https://webmail.example.com/api/v1/admin/users${query}`;
    const response = await GET(new Request(url));
    expect(response.status).toBe(400);
    expect(response.headers.get("x-veda-api-error-code")).toBe("VALIDATION_ERROR");
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });

  it("checks same-origin before authentication on mutations", async () => {
    mocks.assertOrigin.mockImplementationOnce(() => {
      throw new ApiError("Cross-origin request rejected.", "CROSS_ORIGIN", 403);
    });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(mocks.assertAccess).not.toHaveBeenCalled();
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it("returns 401, 413, and 429 before provisioning", async () => {
    mocks.assertAccess.mockRejectedValueOnce(
      new ApiError("Sign in.", "ADMIN_UNAUTHORIZED", 401),
    );
    expect((await POST(request())).status).toBe(401);

    expect(
      (await POST(request(input, { "content-length": "20000" }))).status,
    ).toBe(413);

    mocks.requestRate.mockImplementationOnce(() => {
      throw new ApiError("Wait.", "RATE_LIMITED", 429);
    });
    expect((await POST(request())).status).toBe(429);
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it("step-up verifies the admin and never returns either password", async () => {
    const response = await POST(request());
    const body = JSON.stringify(await response.json());
    expect(response.status).toBe(201);
    expect(body).not.toContain(input.password);
    expect(body).not.toContain(input.currentAdminPassword);
    expect(mocks.stepUp).toHaveBeenCalledWith({
      currentPassword: input.currentAdminPassword,
    });
    expect(mocks.provision).toHaveBeenCalledWith(
      "16161616-1616-4616-8616-161616161616",
      {
        displayName: "Ada",
        email: "ada@example.com",
        password: input.password,
      },
      "installation-secret",
      expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    );
  });

  it("redacts secrets from domain-scope and provider failures", async () => {
    mocks.provision.mockRejectedValueOnce(
      new ApiError(
        "That domain is not managed by this installation.",
        "MAIL_USER_DOMAIN_FORBIDDEN",
        403,
      ),
    );
    const response = await POST(request());
    const body = JSON.stringify(await response.json());
    expect(response.status).toBe(403);
    expect(body).not.toContain(input.password);
    expect(body).not.toContain(input.currentAdminPassword);
  });

  it("sets a refreshed cookie when a recovery code rotates the session", async () => {
    mocks.stepUp.mockResolvedValueOnce({
      installation,
      sessionRotated: true,
    });
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(response.headers.get("set-cookie")).toContain(
      "veda_mail_admin=refreshed-token",
    );
  });

  it("returns the stable cache warning code", async () => {
    mocks.provision.mockResolvedValueOnce({
      outcome: "created",
      user,
      warning: "cache-invalidation-failed",
    });
    const response = await POST(request());
    await expect(response.json()).resolves.toMatchObject({
      data: { warning: "cache-invalidation-failed" },
    });
  });

  it("marks an idempotent replay and does not claim a new password was set", async () => {
    mocks.provision.mockResolvedValueOnce({
      outcome: "created",
      replayed: true,
      user,
    });
    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { replayed: true, user },
    });
  });

  it("requires a UUID key and matching strong mailbox passwords", async () => {
    expect(
      (await POST(request(input, { "idempotency-key": "not-a-uuid" }))).status,
    ).toBe(400);
    expect(
      (
        await POST(
          request({
            ...input,
            confirmPassword: "different password 123",
          }),
        )
      ).status,
    ).toBe(400);
    expect(mocks.stepUp).not.toHaveBeenCalled();
  });
});
