import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(), assertOrigin: vi.fn(), execute: vi.fn(),
  issueToken: vi.fn(), requestRate: vi.fn(),
  stepUp: vi.fn(), subjectRate: vi.fn(), auditAttempt: vi.fn(),
  auditApplied: vi.fn(), auditFailure: vi.fn(), auditOperation: vi.fn(),
  auditSuccess: vi.fn(),
}));
vi.mock("@/server/auth/admin-session", () => ({
  ADMIN_COOKIE: "veda_mail_admin", ADMIN_SESSION_TTL_SECONDS: 43_200,
  adminCookieOptions: { httpOnly: true, path: "/", sameSite: "lax" },
  assertAdminAccess: mocks.assertAccess, issueAdminToken: mocks.issueToken,
}));
vi.mock("@/server/auth/admin-step-up", () => ({ verifyAdminStepUp: mocks.stepUp }));
vi.mock("@/server/installation/request-origin", () => ({ assertSameOrigin: mocks.assertOrigin }));
vi.mock("@/server/mail-users/mail-user-administration", () => ({ getAdminMailUser: vi.fn() }));
vi.mock("@/server/mail-users/mail-user-lifecycle", () => ({ executeMailUserLifecycle: mocks.execute }));
vi.mock("@/server/security/rate-limit", () => ({
  assertRequestRateLimit: mocks.requestRate, assertSubjectRateLimit: mocks.subjectRate,
}));
vi.mock("@/server/security-audit/security-audit", () => ({
  administratorAuditActor: vi.fn(() => ({ actorId: "admin", actorType: "administrator" })),
  auditTargetId: vi.fn(() => "opaque-target"),
}));
vi.mock("@/server/security-audit/security-audit-operation", () => ({
  securityAuditOperation: mocks.auditOperation,
}));

import { DELETE, PATCH } from "@/app/api/v1/admin/users/[userId]/route";
import { ApiError } from "@/transport/http/api-error";

const installation = {
  mailProfile: { allowedDomains: ["example.com"], config: {}, providerId: "stalwart-jmap" },
  owner: { username: "administrator" }, sessionSecret: "session-secret",
};
const user = {
  aliases: [], createdAt: null, displayName: "Ada", email: "ada@example.com",
  id: "account-1", lifecycle: { available: true, protected: false, reason: null },
  locale: null, maxDiskQuota: null, timeZone: null, usedDiskQuota: 0,
};
const context = { params: Promise.resolve({ userId: "account-1" }) };
const url = "https://webmail.example.com/api/v1/admin/users/account-1?domain=example.com";
const request = (method: "DELETE" | "PATCH", confirmationEmail = user.email) =>
  new Request(url, { body: JSON.stringify({
    confirmationEmail, currentAdminPassword: "admin-password", otpCode: "123456",
  }), headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID(),
    origin: "https://webmail.example.com" }, method });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.stepUp.mockResolvedValue({ installation, sessionRotated: false });
  mocks.execute.mockResolvedValue({
    email: user.email, forwardingRemoved: true, outcome: "disabled",
    sessionsRevoked: 2, userId: user.id,
  });
  mocks.auditOperation.mockReturnValue({
    applied: mocks.auditApplied, attempt: mocks.auditAttempt,
    failureIfPending: mocks.auditFailure, success: mocks.auditSuccess,
  });
});

describe("admin mailbox lifecycle API", () => {
  it("requires step-up, exact-email confirmation, idempotency and audits disable", async () => {
    const req = request("PATCH");
    const key = req.headers.get("idempotency-key");
    const response = await PATCH(req, context);
    expect(response.status).toBe(200);
    expect(mocks.stepUp).toHaveBeenCalledWith({
      currentPassword: "admin-password", otpCode: "123456",
    });
    expect(mocks.execute).toHaveBeenCalledWith(
      key,
      { domain: "example.com", email: user.email, operation: "disable", userId: user.id },
      installation.sessionSecret,
      expect.any(String),
      expect.any(Function),
    );
    expect(mocks.auditOperation).toHaveBeenCalledWith(expect.objectContaining({
      action: "admin.mail-user.disabled", targetId: "opaque-target", targetType: "user",
    }));
    expect(mocks.auditAttempt).toHaveBeenCalledBefore(mocks.execute);
    expect(mocks.auditSuccess).toHaveBeenCalledWith(2);
  });

  it("keeps delete distinct and rejects a non-exact confirmation", async () => {
    mocks.execute.mockRejectedValueOnce(new ApiError(
      "Type the complete mailbox email address exactly to confirm.",
      "MAIL_USER_CONFIRMATION_MISMATCH",
      400,
    ));
    expect((await DELETE(request("DELETE", "Ada@example.com"), context)).status).toBe(400);
    expect(mocks.execute).toHaveBeenCalledOnce();

    mocks.execute.mockResolvedValueOnce({
      email: user.email, forwardingRemoved: false, outcome: "deleted",
      sessionsRevoked: 0, userId: user.id,
    });
    expect((await DELETE(request("DELETE"), context)).status).toBe(200);
    expect(mocks.auditOperation).toHaveBeenCalledWith(expect.objectContaining({
      action: "admin.mail-user.deleted",
    }));
  });

  it("hides protected accounts from destructive execution", async () => {
    mocks.execute.mockRejectedValueOnce(new ApiError(
      "This operational or automation mailbox is protected.",
      "MAIL_USER_PROTECTED",
      409,
    ));
    const response = await DELETE(request("DELETE"), context);
    expect(response.status).toBe(409);
    expect(response.headers.get("x-veda-api-error-code")).toBe("MAIL_USER_PROTECTED");
    expect(mocks.execute).toHaveBeenCalledOnce();
  });

  it("rejects cross-origin before authentication and audits provider failure", async () => {
    mocks.assertOrigin.mockImplementationOnce(() => {
      throw new ApiError("Cross origin", "CROSS_ORIGIN", 403);
    });
    expect((await PATCH(request("PATCH"), context)).status).toBe(403);
    expect(mocks.assertAccess).not.toHaveBeenCalled();

    mocks.execute.mockRejectedValueOnce(new ApiError("Provider denied", "MAIL_USER_PROVIDER_AUTH", 503));
    expect((await PATCH(request("PATCH"), context)).status).toBe(503);
    expect(mocks.auditFailure).toHaveBeenCalledOnce();
  });
});
