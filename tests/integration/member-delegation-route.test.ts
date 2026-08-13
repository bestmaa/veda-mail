import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertRequestRateLimit: vi.fn(), assertSubjectRateLimit: vi.fn(),
  deleteDelegation: vi.fn(), getCurrentConnection: vi.fn(),
  getDelegationCapability: vi.fn(), listDelegations: vi.fn(),
  updateDelegation: vi.fn(),
}));

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.getCurrentConnection,
}));
vi.mock("@/server/mail/gateway-cache", () => ({
  resolveGateway: vi.fn(async () => ({
    deleteDelegation: mocks.deleteDelegation,
    getDelegationCapability: mocks.getDelegationCapability,
    listDelegations: mocks.listDelegations,
    updateDelegation: mocks.updateDelegation,
  })),
}));
vi.mock("@/server/security/rate-limit", () => ({
  assertRequestRateLimit: mocks.assertRequestRateLimit,
  assertSubjectRateLimit: mocks.assertSubjectRateLimit,
}));
vi.mock("@/server/security-audit/security-audit", () => ({
  appendSecurityAudit: vi.fn(), auditTargetId: vi.fn(() => "target"),
  memberAuditActor: vi.fn(() => ({ actorId: "audit", actorType: "member" })),
}));

import { DELETE, GET, PUT } from "@/app/api/v1/member/delegation/route";
import { id } from "@/domain/shared/brand";
import { mailSessionScope } from "@/server/connections/mail-session-scope";

const origin = "https://mail.example.test";
const connection = { config: {}, createdAt: "2026-08-13T00:00:00.000Z",
  displayName: "Mail", id: id.connection("delegation-route-connection"),
  providerId: id.provider("mock") };
const request = (method: "DELETE" | "GET" | "PUT", body?: unknown,
  requestOrigin = origin, scope = mailSessionScope(connection)) =>
  new Request(`${origin}/api/v1/member/delegation`, {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }),
      host: "mail.example.test", origin: requestOrigin,
      "x-veda-mail-session-scope": scope }, method,
  });

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getCurrentConnection.mockResolvedValue(connection);
  mocks.getDelegationCapability.mockResolvedValue({ mailbox: "INBOX", supported: true });
  mocks.listDelegations.mockResolvedValue([]);
  mocks.updateDelegation.mockImplementation(async (input) => [input]);
  mocks.deleteDelegation.mockResolvedValue([]);
});

describe("member delegation route", () => {
  it("returns provider ACL entries only when capability is advertised", async () => {
    mocks.listDelegations.mockResolvedValue([{ access: "read", identifier: "peer@example.com" }]);
    const response = await GET(request("GET"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: {
      capability: { mailbox: "INBOX", supported: true },
      entries: [{ access: "read", identifier: "peer@example.com" }],
    } });
    mocks.getDelegationCapability.mockResolvedValueOnce({ reason: "No ACL", supported: false });
    const unsupported = await GET(request("GET"));
    await expect(unsupported.json()).resolves.toMatchObject({ data: { entries: [] } });
  });

  it("creates, updates, and deletes a scoped delegation", async () => {
    const input = { access: "manage", identifier: "peer@example.com" } as const;
    const created = await PUT(request("PUT", input));
    expect(created.status).toBe(200);
    expect(mocks.updateDelegation).toHaveBeenCalledWith(input);
    expect((await PUT(request("PUT", input))).status).toBe(200);
    expect((await DELETE(request("DELETE", { identifier: input.identifier }))).status).toBe(200);
    expect(mocks.deleteDelegation).toHaveBeenCalledWith(input.identifier);
  });

  it("rejects stale scope, cross-origin writes, reserved identities, and mass assignment", async () => {
    expect((await GET(request("GET", undefined, origin, "stale"))).status).toBe(409);
    expect((await PUT(request("PUT", { access: "read", identifier: "peer@example.com" },
      "https://attacker.test"))).status).toBe(403);
    expect((await PUT(request("PUT", { access: "read", identifier: "anyone" }))).status).toBe(400);
    expect((await PUT(request("PUT", { access: "read", identifier: "peer@example.com", owner: true }))).status).toBe(400);
    expect(mocks.updateDelegation).not.toHaveBeenCalled();
  });

  it("does not mutate when the provider does not advertise delegation", async () => {
    mocks.getDelegationCapability.mockResolvedValue({ reason: "No ACL", supported: false });
    const response = await PUT(request("PUT", { access: "read", identifier: "peer@example.com" }));
    expect(response.status).toBe(422);
    expect(mocks.updateDelegation).not.toHaveBeenCalled();
  });
});
