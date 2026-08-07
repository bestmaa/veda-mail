import { beforeEach, describe, expect, it, vi } from "vitest";

const handle = "a".repeat(43);
const mocks = vi.hoisted(() => ({
  adminList: vi.fn(),
  adminRemove: vi.fn(),
  appendAudit: vi.fn(),
  assertAdminAccess: vi.fn(),
  currentSessionId: vi.fn(),
  installationGet: vi.fn(),
  memberList: vi.fn(),
  memberRemove: vi.fn(),
  readJsonBody: vi.fn(),
}));

vi.mock("@/server/auth/admin-session", () => ({
  ADMIN_COOKIE: "veda_mail_admin",
  adminCookieOptions: { httpOnly: true, path: "/", sameSite: "lax" },
  assertAdminAccess: mocks.assertAdminAccess,
  getCurrentAdminSessionId: mocks.currentSessionId,
}));
vi.mock("@/server/auth/admin-session-store", () => ({
  ADMIN_SESSION_IDLE_TTL_SECONDS: 1_800,
  adminSessionStore: { list: mocks.adminList, remove: mocks.adminRemove },
}));
vi.mock("@/server/auth/session-management", () => ({
  sessionManagementId: (_kind: string, id: string) => id === "admin-current" || id === "member-a" ? handle : "b".repeat(43),
}));
vi.mock("@/server/connections/connection-store", () => ({
  connectionStore: { listAll: mocks.memberList, remove: mocks.memberRemove },
}));
vi.mock("@/server/installation/installation.store", () => ({
  installationStore: { get: mocks.installationGet },
}));
vi.mock("@/server/security/rate-limit", () => ({
  assertRequestRateLimit: vi.fn(), assertSubjectRateLimit: vi.fn(),
}));
vi.mock("@/server/security-audit/security-audit", () => ({
  appendSecurityAudit: mocks.appendAudit,
  installationAdministratorAuditActor: () => ({ actorId: "admin", actorType: "administrator" }),
}));
vi.mock("@/transport/http/read-json-body", () => ({ readJsonBody: mocks.readJsonBody }));

import { DELETE, GET } from "@/app/api/v1/admin/sessions/route";
import { id } from "@/domain/shared/brand";

const adminSession = {
  authVersion: 7,
  createdAt: "2026-08-06T10:00:00.000Z",
  expiresAt: "2026-08-06T22:00:00.000Z",
  id: "admin-current",
  lastSeenAt: "2026-08-06T11:00:00.000Z",
};
const memberSession = {
  clientLabel: "Chrome on Windows",
  connection: {
    config: { password: "must-not-leak" },
    createdAt: "2026-08-06T10:00:00.000Z",
    displayName: "Mailbox",
    id: id.connection("member-a"),
    providerId: id.provider("mock"),
  },
  deliveryNoticeCapacityWarning: false,
  lastSeenAt: "2026-08-06T11:00:00.000Z",
  ownerKey: "opaque-owner",
  profileRevision: "revision",
};
const request = (method: "DELETE" | "GET") => new Request(
  "https://mail.example.com/api/v1/admin/sessions",
  {
    ...(method === "DELETE" ? { body: "{}" } : {}),
    headers: { host: "mail.example.com", origin: "https://mail.example.com" },
    method,
  },
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.adminList.mockReturnValue([adminSession]);
  mocks.memberList.mockReturnValue([memberSession]);
  mocks.currentSessionId.mockResolvedValue("admin-current");
  mocks.installationGet.mockResolvedValue({ owner: { authVersion: 7 } });
});

describe("administrator session management route", () => {
  it("returns privacy-safe handles without provider credentials", async () => {
    const response = await GET(request("GET"));
    const body = JSON.stringify(await response.json());
    expect(response.status).toBe(200);
    expect(body).toContain(handle);
    expect(body).not.toContain("must-not-leak");
    expect(body).not.toContain("member-a");
  });

  it("revokes the current admin session and clears its cookie", async () => {
    mocks.readJsonBody.mockResolvedValue({ id: handle, kind: "administrator" });
    const response = await DELETE(request("DELETE"));
    expect(response.status).toBe(200);
    expect(mocks.adminRemove).toHaveBeenCalledWith("admin-current");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(mocks.appendAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "admin.session.revoked", targetId: handle,
    }));
  });

  it("revokes a member session without exposing its bearer id", async () => {
    mocks.readJsonBody.mockResolvedValue({ id: handle, kind: "member" });
    const response = await DELETE(request("DELETE"));
    expect(response.status).toBe(200);
    expect(mocks.memberRemove).toHaveBeenCalledWith(id.connection("member-a"));
  });
});
