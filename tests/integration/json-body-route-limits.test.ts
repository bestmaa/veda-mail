import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertRequestRateLimit: vi.fn(),
  assertSubjectRateLimit: vi.fn(),
  connectionCreate: vi.fn(),
  connectionIsActive: vi.fn(),
  connectionRemove: vi.fn(),
  getCurrentConnection: vi.fn(),
  getMailServiceProfile: vi.fn(),
  getProvider: vi.fn(),
  getProviderRegistry: vi.fn(),
  getInstallation: vi.fn(),
  hasAdminAccess: vi.fn(),
  issueAdminToken: vi.fn(),
  memberTwoFactorIsEnabled: vi.fn(),
  memberTwoFactorVerify: vi.fn(),
  providerAuthenticateMember: vi.fn(),
  resolveGateway: vi.fn(),
  verifyAdminCredentials: vi.fn(),
}));

vi.mock("@/bootstrap/provider-registry", () => ({
  getProviderRegistry: mocks.getProviderRegistry,
}));

vi.mock("@/server/auth/admin-session", () => ({
  ADMIN_COOKIE: "veda-admin",
  ADMIN_SESSION_TTL_SECONDS: 3_600,
  adminCookieOptions: {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: false,
  },
  hasAdminAccess: mocks.hasAdminAccess,
  issueAdminToken: mocks.issueAdminToken,
  verifyAdminCredentials: mocks.verifyAdminCredentials,
}));

vi.mock("@/server/auth/admin-two-factor", () => ({
  verifyAdminSecondFactor: vi.fn(),
  withoutRecoveryCode: vi.fn(),
}));

vi.mock("@/server/auth/member-two-factor", () => ({
  memberTwoFactorSecurity: {
    isEnabled: mocks.memberTwoFactorIsEnabled,
    verify: mocks.memberTwoFactorVerify,
  },
}));

vi.mock("@/server/auth/two-factor-enrollment", () => ({
  twoFactorEnrollmentStore: {
    remove: vi.fn(),
  },
}));

vi.mock("@/server/connections/connection-session", () => ({
  CONNECTION_COOKIE: "veda-connection",
  getCurrentConnection: mocks.getCurrentConnection,
}));

vi.mock("@/server/connections/connection-store", () => ({
  connectionStore: {
    create: mocks.connectionCreate,
    isActive: mocks.connectionIsActive,
    remove: mocks.connectionRemove,
  },
}));

vi.mock("@/server/installation/installation.store", () => ({
  installationStore: {
    get: mocks.getInstallation,
    isInstalled: vi.fn(),
    updateOwner: vi.fn(),
  },
}));

vi.mock("@/server/mail/gateway-cache", () => ({
  resolveGateway: mocks.resolveGateway,
}));

vi.mock("@/server/mail-service/mail-service-profile.store", () => ({
  mailServiceProfileStore: {
    get: mocks.getMailServiceProfile,
  },
}));

vi.mock("@/server/security/rate-limit", () => ({
  assertRequestRateLimit: mocks.assertRequestRateLimit,
  assertSubjectRateLimit: mocks.assertSubjectRateLimit,
}));

import { POST as adminLogin } from "@/app/api/v1/admin/auth/route";
import { POST as memberLogin } from "@/app/api/v1/member/session/route";

const origin = "https://mail.example.com";

const oversizedJsonRequest = (path: string): Request => {
  const body = JSON.stringify({ padding: "x".repeat(16 * 1024) });
  return new Request(`${origin}${path}`, {
    body,
    headers: {
      "content-length": String(new TextEncoder().encode(body).byteLength),
      "content-type": "application/json",
      host: "mail.example.com",
      origin,
    },
    method: "POST",
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getInstallation.mockResolvedValue({});
  mocks.getProviderRegistry.mockReturnValue({
    get: mocks.getProvider,
  });
  mocks.getProvider.mockReturnValue({
    authenticateMember: mocks.providerAuthenticateMember,
  });
});

describe("bounded JSON API routes", () => {
  it("rejects an oversized administrator login before credential verification", async () => {
    const response = await adminLogin(
      oversizedJsonRequest("/api/v1/admin/auth"),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "REQUEST_BODY_TOO_LARGE",
        message: "The JSON request body is too large.",
      },
    });
    expect(mocks.verifyAdminCredentials).not.toHaveBeenCalled();
    expect(mocks.issueAdminToken).not.toHaveBeenCalled();
  });

  it("rejects an oversized member login before provider authentication or session mutation", async () => {
    const response = await memberLogin(
      oversizedJsonRequest("/api/v1/member/session"),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "REQUEST_BODY_TOO_LARGE",
        message: "The JSON request body is too large.",
      },
    });
    expect(mocks.getMailServiceProfile).not.toHaveBeenCalled();
    expect(mocks.providerAuthenticateMember).not.toHaveBeenCalled();
    expect(mocks.connectionCreate).not.toHaveBeenCalled();
  });
});
