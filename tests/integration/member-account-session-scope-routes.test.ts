import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertOrganizationFeatureEnabled: vi.fn(),
  assertRequestRateLimit: vi.fn(),
  assertSubjectRateLimit: vi.fn(),
  connectionCreate: vi.fn(),
  connectionIsActive: vi.fn(),
  connectionRemove: vi.fn(),
  connectionUpdate: vi.fn(),
  enrollmentCreate: vi.fn(),
  enrollmentRemove: vi.fn(),
  enrollmentVerify: vi.fn(),
  getCurrentConnection: vi.fn(),
  getProviderRegistry: vi.fn(),
  loadAttachmentCapability: vi.fn(),
  profileGet: vi.fn(),
  getOrganizationPolicy: vi.fn(),
  readJsonBody: vi.fn(),
  resolveGateway: vi.fn(),
  twoFactorDisable: vi.fn(),
  twoFactorEnable: vi.fn(),
  twoFactorIsEnabled: vi.fn(),
  twoFactorVerify: vi.fn(),
}));

vi.mock("@/bootstrap/provider-registry", () => ({
  getProviderRegistry: mocks.getProviderRegistry,
}));
vi.mock("@/server/auth/member-two-factor", () => ({
  memberTwoFactorSecurity: {
    disable: mocks.twoFactorDisable,
    enable: mocks.twoFactorEnable,
    isEnabled: mocks.twoFactorIsEnabled,
    verify: mocks.twoFactorVerify,
  },
}));
vi.mock("@/server/auth/two-factor-enrollment", () => ({
  twoFactorEnrollmentStore: {
    create: mocks.enrollmentCreate,
    remove: mocks.enrollmentRemove,
    verify: mocks.enrollmentVerify,
  },
}));
vi.mock("@/server/connections/connection-session", () => ({
  CONNECTION_COOKIE: "veda-mail-connection",
  getCurrentConnection: mocks.getCurrentConnection,
}));
vi.mock("@/server/connections/connection-store", () => ({
  connectionStore: {
    create: mocks.connectionCreate,
    isActive: mocks.connectionIsActive,
    remove: mocks.connectionRemove,
    updateConfig: mocks.connectionUpdate,
  },
}));
vi.mock("@/server/mail/attachment-service", () => ({
  loadAttachmentCapability: mocks.loadAttachmentCapability,
}));
vi.mock("@/server/mail/gateway-cache", () => ({
  resolveGateway: mocks.resolveGateway,
}));
vi.mock("@/server/mail-service/mail-service-profile.store", () => ({
  mailServiceProfileStore: { get: mocks.profileGet },
}));
vi.mock("@/server/security/rate-limit", () => ({
  assertRequestRateLimit: mocks.assertRequestRateLimit,
  assertSubjectRateLimit: mocks.assertSubjectRateLimit,
}));
vi.mock("@/server/organization/organization-policy.service", () => ({
  assertOrganizationFeatureEnabled: mocks.assertOrganizationFeatureEnabled,
  getOrganizationPolicy: mocks.getOrganizationPolicy,
}));
vi.mock("@/transport/http/read-json-body", () => ({
  readJsonBody: mocks.readJsonBody,
}));
vi.mock("@/server/security-audit/security-audit", () => ({ appendSecurityAudit: vi.fn(), memberAuditActor: vi.fn(() => ({ actorId: "audit", actorType: "member" })) }));
import {
  GET as readSettings,
  PATCH as updateProfile,
  PUT as changePassword,
} from "@/app/api/v1/member/settings/route";
import {
  DELETE as signOut,
  GET as readSession,
} from "@/app/api/v1/member/session/route";
import {
  DELETE as disableTwoFactor,
  POST as startTwoFactor,
  PUT as confirmTwoFactor,
} from "@/app/api/v1/member/two-factor/route";
import type { ProviderConnection } from "@/domain/provider/provider";
import { id } from "@/domain/shared/brand";
import { mailSessionScope } from "@/server/connections/mail-session-scope";
import { ApiError } from "@/transport/http/api-error";

const origin = "https://mail.example.com";
const connection: ProviderConnection = {
  config: {},
  createdAt: "2026-07-31T10:00:00.000Z",
  displayName: "Member mailbox",
  id: id.connection("member-account-current"),
  providerId: id.provider("mock"),
};
const staleScope = mailSessionScope({ id: "member-account-stale" });
const request = (
  path: string,
  method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT",
  includeScope = true,
) =>
  new Request(`${origin}${path}`, {
    ...(method === "GET" ? {} : { body: "{}" }),
    headers: {
      "content-type": "application/json",
      host: "mail.example.com",
      origin,
      ...(includeScope
        ? { "x-veda-mail-session-scope": staleScope }
        : {}),
    },
    method,
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentConnection.mockResolvedValue(connection);
  mocks.connectionIsActive.mockReturnValue(true);
  mocks.getOrganizationPolicy.mockResolvedValue({
    memberPasswordChange: true,
    memberProfileEditing: true,
    memberTwoFactorEnrollment: true,
  });
});

describe("member account session scope routes", () => {
  it.each([
    ["settings read", readSettings, "GET", "/api/v1/member/settings"],
    ["profile update", updateProfile, "PATCH", "/api/v1/member/settings"],
    ["password change", changePassword, "PUT", "/api/v1/member/settings"],
    ["two-factor start", startTwoFactor, "POST", "/api/v1/member/two-factor"],
    ["two-factor confirm", confirmTwoFactor, "PUT", "/api/v1/member/two-factor"],
    ["two-factor disable", disableTwoFactor, "DELETE", "/api/v1/member/two-factor"],
    ["sign out", signOut, "DELETE", "/api/v1/member/session"],
  ] as const)(
    "rejects stale scope for %s before account work",
    async (_, handler, method, path) => {
      const response = await handler(request(path, method));

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "MAIL_SESSION_CHANGED",
          message: "Mailbox session changed. Reload this page and try again.",
        },
      });
      expect(mocks.assertSubjectRateLimit).not.toHaveBeenCalled();
      expect(mocks.readJsonBody).not.toHaveBeenCalled();
      expect(mocks.getProviderRegistry).not.toHaveBeenCalled();
      expect(mocks.resolveGateway).not.toHaveBeenCalled();
      expect(mocks.profileGet).not.toHaveBeenCalled();
      expect(mocks.loadAttachmentCapability).not.toHaveBeenCalled();
      expect(mocks.twoFactorIsEnabled).not.toHaveBeenCalled();
      expect(mocks.twoFactorEnable).not.toHaveBeenCalled();
      expect(mocks.twoFactorDisable).not.toHaveBeenCalled();
      expect(mocks.twoFactorVerify).not.toHaveBeenCalled();
      expect(mocks.enrollmentCreate).not.toHaveBeenCalled();
      expect(mocks.enrollmentVerify).not.toHaveBeenCalled();
      expect(mocks.enrollmentRemove).not.toHaveBeenCalled();
      expect(mocks.connectionUpdate).not.toHaveBeenCalled();
      expect(mocks.connectionRemove).not.toHaveBeenCalled();
    },
  );

  it("keeps sign-out idempotent when no current connection exists", async () => {
    mocks.getCurrentConnection.mockRejectedValueOnce(
      new ApiError("Sign in first.", "MEMBER_SESSION_REQUIRED", 401),
    );

    const response = await signOut(
      request("/api/v1/member/session", "DELETE", false),
    );

    expect(response.status).toBe(204);
    expect(mocks.enrollmentRemove).not.toHaveBeenCalled();
    expect(mocks.connectionRemove).not.toHaveBeenCalled();
  });

  it.each([
    ["profile editing", updateProfile, "PATCH", "memberProfileEditing"],
    ["password changes", changePassword, "PUT", "memberPasswordChange"],
    ["two-factor start", startTwoFactor, "POST", "memberTwoFactorEnrollment"],
    ["two-factor confirmation", confirmTwoFactor, "PUT", "memberTwoFactorEnrollment"],
  ] as const)(
    "enforces organization policy before %s side effects",
    async (_, handler, method, feature) => {
      mocks.assertOrganizationFeatureEnabled.mockRejectedValueOnce(
        new ApiError(
          "Your organization has disabled this account feature.",
          "ORGANIZATION_POLICY_DISABLED",
          403,
        ),
      );
      const response = await handler(
        new Request(`${origin}/api/v1/member/settings`, {
          body: "{}",
          headers: {
            "content-type": "application/json",
            host: "mail.example.com",
            origin,
            "x-veda-mail-session-scope": mailSessionScope(connection),
          },
          method,
        }),
      );

      expect(response.status).toBe(403);
      expect(mocks.assertOrganizationFeatureEnabled).toHaveBeenCalledWith(
        feature,
      );
      expect(mocks.readJsonBody).not.toHaveBeenCalled();
      expect(mocks.resolveGateway).not.toHaveBeenCalled();
      expect(mocks.enrollmentCreate).not.toHaveBeenCalled();
    },
  );

  it("does not return account data after the connection expires in flight", async () => {
    mocks.resolveGateway.mockResolvedValue({
      getAccount: vi.fn().mockResolvedValue({
        email: "member@example.com",
        id: "account-1",
        name: "Member",
        providerId: "mock",
      }),
    });
    mocks.profileGet.mockResolvedValue({
      displayName: "Member mailbox",
      providerId: "mock",
    });
    mocks.connectionIsActive.mockReturnValue(false);

    const response = await readSession();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { account: null, authenticated: false, service: null },
    });
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
