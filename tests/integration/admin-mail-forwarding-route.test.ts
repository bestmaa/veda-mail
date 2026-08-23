import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(), assertOrigin: vi.fn(), getSnapshot: vi.fn(),
  getUser: vi.fn(), issueToken: vi.fn(), remove: vi.fn(), requestRate: vi.fn(),
  set: vi.fn(), stepUp: vi.fn(), subjectRate: vi.fn(),
  auditAttempt: vi.fn(), auditApplied: vi.fn(), auditFailure: vi.fn(),
  auditOperation: vi.fn(), auditSuccess: vi.fn(),
}));

vi.mock("@/server/auth/admin-session", () => ({
  ADMIN_COOKIE: "veda_mail_admin", ADMIN_SESSION_TTL_SECONDS: 43_200,
  adminCookieOptions: { httpOnly: true, path: "/", sameSite: "lax" },
  assertAdminAccess: mocks.assertAccess, issueAdminToken: mocks.issueToken,
}));
vi.mock("@/server/auth/admin-step-up", () => ({ verifyAdminStepUp: mocks.stepUp }));
vi.mock("@/server/installation/request-origin", () => ({ assertSameOrigin: mocks.assertOrigin }));
vi.mock("@/server/mail-forwarding/mail-forwarding.service", () => ({
  getMailForwardingSnapshot: mocks.getSnapshot,
  removeMailForwarding: mocks.remove,
  setMailForwarding: mocks.set,
}));
vi.mock("@/server/mail-users/mail-user-administration", () => ({
  getAdminMailUser: mocks.getUser,
}));
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

import { DELETE, GET, PUT } from "@/app/api/v1/admin/users/[userId]/forwarding/route";
import { ApiError } from "@/transport/http/api-error";

const installation = { owner: { username: "administrator" }, sessionSecret: "secret" };
const user = { aliases: ["team@example.com"], email: "ada@example.com", id: "account-1" };
const emptySnapshot = { availability: "available", configuration: null, reason: null, revision: 0 };
const activeLedger = {
  entries: [{ destinationEmail: "ada@gmail.com", keepLocalCopy: true,
    sourceAddresses: ["ada@example.com", "team@example.com"], sourceEmail: "ada@example.com",
    status: "active", updatedAt: "2026-08-23T00:00:00.000Z" }],
  revision: 2, updatedAt: "2026-08-23T00:00:00.000Z", version: 1,
};
const context = { params: Promise.resolve({ userId: "account-1" }) };
const url = "https://webmail.example.com/api/v1/admin/users/account-1/forwarding?domain=example.com";
const mutation = (method: "DELETE" | "PUT", body: unknown, origin = "https://webmail.example.com") =>
  new Request(url, { body: JSON.stringify(body), headers: {
    "content-type": "application/json", host: "webmail.example.com", origin,
  }, method });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue(user);
  mocks.getSnapshot.mockResolvedValue(emptySnapshot);
  mocks.set.mockResolvedValue(activeLedger);
  mocks.remove.mockResolvedValue({ ...activeLedger, entries: [], revision: 3 });
  mocks.stepUp.mockResolvedValue({ installation, sessionRotated: false });
  mocks.issueToken.mockResolvedValue("rotated-token");
  mocks.auditOperation.mockReturnValue({
    applied: mocks.auditApplied, attempt: mocks.auditAttempt,
    failureIfPending: mocks.auditFailure, success: mocks.auditSuccess,
  });
});

describe("administrator mail forwarding route", () => {
  it("requires admin access for read-only state", async () => {
    const response = await GET(new Request(url), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.getSnapshot).toHaveBeenCalledWith("ada@example.com");

    mocks.assertAccess.mockRejectedValueOnce(new ApiError("Sign in.", "ADMIN_UNAUTHORIZED", 401));
    expect((await GET(new Request(url), context)).status).toBe(401);
  });

  it("step-up protects enable and applies primary plus aliases", async () => {
    const body = { currentAdminPassword: "correct horse battery staple",
      destinationEmail: "ada@gmail.com", confirmDestinationEmail: "ada@gmail.com",
      expectedRevision: 0, otpCode: "123456" };
    const response = await PUT(mutation("PUT", body), context);

    expect(response.status).toBe(200);
    expect(mocks.stepUp).toHaveBeenCalledWith({
      currentPassword: body.currentAdminPassword, otpCode: body.otpCode,
    });
    expect(mocks.set).toHaveBeenCalledWith(
      "ada@example.com", ["ada@example.com", "team@example.com"], "ada@gmail.com", 0,
    );
    expect(mocks.auditOperation).toHaveBeenCalledWith(expect.objectContaining({
      action: "admin.mail-forwarding.enabled", targetId: "opaque-target",
      targetType: "forwarding",
    }));
    expect(JSON.stringify(mocks.auditOperation.mock.calls)).not.toContain("ada@gmail.com");
    expect(mocks.auditAttempt).toHaveBeenCalledBefore(mocks.set);
    expect(mocks.auditSuccess).toHaveBeenCalledOnce();
  });

  it("rejects cross-origin and mismatched confirmation before mutation", async () => {
    mocks.assertOrigin.mockImplementationOnce(() => {
      throw new ApiError("Cross-origin request rejected.", "CROSS_ORIGIN", 403);
    });
    const body = { currentAdminPassword: "password", destinationEmail: "ada@gmail.com",
      confirmDestinationEmail: "ada@outlook.com", expectedRevision: 0 };
    expect((await PUT(mutation("PUT", body, "https://attacker.example"), context)).status).toBe(403);
    expect(mocks.assertAccess).not.toHaveBeenCalled();
    expect((await PUT(mutation("PUT", body), context)).status).toBe(400);
    expect(mocks.stepUp).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("step-up protects disable and records provider failure", async () => {
    const body = { currentAdminPassword: "password", expectedRevision: 2 };
    mocks.remove.mockRejectedValueOnce(new ApiError(
      "Provider unavailable.", "MAIL_FORWARDING_PROVIDER_UNAVAILABLE", 503,
    ));
    const response = await DELETE(mutation("DELETE", body), context);
    expect(response.status).toBe(503);
    expect(mocks.remove).toHaveBeenCalledWith("ada@example.com", 2);
    expect(mocks.auditOperation).toHaveBeenCalledWith(expect.objectContaining({
      action: "admin.mail-forwarding.disabled",
    }));
    expect(mocks.auditFailure).toHaveBeenCalledOnce();
    expect(mocks.auditSuccess).not.toHaveBeenCalled();
  });
});
