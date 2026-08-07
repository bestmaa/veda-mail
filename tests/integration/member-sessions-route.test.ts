import { beforeEach, describe, expect, it, vi } from "vitest";

const handle = "c".repeat(43);
const mocks = vi.hoisted(() => ({
  appendAudit: vi.fn(),
  getCurrentConnection: vi.fn(),
  getStored: vi.fn(),
  listForOwner: vi.fn(),
  readJsonBody: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/server/auth/session-management", () => ({
  sessionManagementId: (_kind: string, id: string) => id === "current" ? handle : "d".repeat(43),
}));
vi.mock("@/server/connections/connection-session", () => ({
  CONNECTION_COOKIE: "veda_mail_connection",
  getCurrentConnection: mocks.getCurrentConnection,
}));
vi.mock("@/server/connections/connection-store", () => ({
  connectionStore: {
    get: mocks.getStored,
    listForOwner: mocks.listForOwner,
    remove: mocks.remove,
  },
}));
vi.mock("@/server/security/rate-limit", () => ({
  assertRequestRateLimit: vi.fn(), assertSubjectRateLimit: vi.fn(),
}));
vi.mock("@/server/security-audit/security-audit", () => ({
  appendSecurityAudit: mocks.appendAudit,
  memberAuditActor: () => ({ actorId: "member", actorType: "member" }),
}));
vi.mock("@/transport/http/read-json-body", () => ({ readJsonBody: mocks.readJsonBody }));

import { DELETE, GET } from "@/app/api/v1/member/sessions/route";
import type { ProviderConnection } from "@/domain/provider/provider";
import { id } from "@/domain/shared/brand";
import { mailSessionScope } from "@/server/connections/mail-session-scope";

const connection: ProviderConnection = {
  config: { password: "must-not-leak" },
  createdAt: "2026-08-06T10:00:00.000Z",
  displayName: "Mailbox",
  id: id.connection("current"),
  providerId: id.provider("mock"),
};
const stored = {
  clientLabel: "Firefox on Linux",
  connection,
  deliveryNoticeCapacityWarning: false,
  lastSeenAt: "2026-08-06T11:00:00.000Z",
  ownerKey: "owner-a",
  profileRevision: "revision",
};
const request = (method: "DELETE" | "GET") => new Request(
  "https://mail.example.com/api/v1/member/sessions",
  {
    ...(method === "DELETE" ? { body: "{}" } : {}),
    headers: {
      host: "mail.example.com",
      origin: "https://mail.example.com",
      "x-veda-mail-session-scope": mailSessionScope(connection),
    },
    method,
  },
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentConnection.mockResolvedValue(connection);
  mocks.getStored.mockReturnValue(stored);
  mocks.listForOwner.mockReturnValue([stored]);
});

describe("member session management route", () => {
  it("lists only safe session metadata for the current owner", async () => {
    const response = await GET(request("GET"));
    const body = JSON.stringify(await response.json());
    expect(response.status).toBe(200);
    expect(mocks.listForOwner).toHaveBeenCalledWith("owner-a");
    expect(body).toContain("Firefox on Linux");
    expect(body).not.toContain("must-not-leak");
    expect(body).not.toContain('"id":"current"');
  });

  it("audits current-session revocation before clearing the bearer cookie", async () => {
    mocks.readJsonBody.mockResolvedValue({ id: handle });
    const response = await DELETE(request("DELETE"));
    expect(response.status).toBe(200);
    expect(mocks.appendAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "member.session.revoked", targetId: handle,
    }));
    expect(mocks.remove).toHaveBeenCalledWith(connection.id);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("fails safe by revoking even when the audit sink is unavailable", async () => {
    mocks.readJsonBody.mockResolvedValue({ id: handle });
    mocks.appendAudit.mockRejectedValueOnce(new Error("audit unavailable"));
    const response = await DELETE(request("DELETE"));
    expect(response.status).toBe(500);
    expect(mocks.remove).toHaveBeenCalledWith(connection.id);
  });
});
