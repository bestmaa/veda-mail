import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertRequestRateLimit: vi.fn(),
  assertSubjectRateLimit: vi.fn(),
  getCurrentConnection: vi.fn(),
  getVacationCapability: vi.fn(),
  getVacationResponse: vi.fn(),
  getDelegationCapability: vi.fn(),
  updateVacationResponse: vi.fn(),
}));

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.getCurrentConnection,
}));
vi.mock("@/server/mail/gateway-cache", () => ({
  resolveGateway: vi.fn(async () => ({
    getVacationCapability: mocks.getVacationCapability,
    getVacationResponse: mocks.getVacationResponse,
    getDelegationCapability: mocks.getDelegationCapability,
    updateVacationResponse: mocks.updateVacationResponse,
  })),
}));
vi.mock("@/server/security/rate-limit", () => ({
  assertRequestRateLimit: mocks.assertRequestRateLimit,
  assertSubjectRateLimit: mocks.assertSubjectRateLimit,
}));
vi.mock("@/server/security-audit/security-audit", () => ({
  appendSecurityAudit: vi.fn(), memberAuditActor: vi.fn(() => ({
    actorId: "audit", actorType: "member",
  })),
}));

import { GET, PUT } from "@/app/api/v1/member/vacation/route";
import { MAX_VACATION_REQUEST_BYTES } from "@/domain/mail/vacation";
import { id } from "@/domain/shared/brand";
import { mailSessionScope } from "@/server/connections/mail-session-scope";

const origin = "https://mail.example.test";
const connection = { config: {}, createdAt: "2026-08-09T00:00:00.000Z",
  displayName: "Mail", id: id.connection("vacation-route-connection"),
  providerId: id.provider("mock") };
const response = { fromDate: null, htmlBody: null, isEnabled: false,
  revision: "state-1", subject: null, textBody: null, toDate: null };
const update = { expectedRevision: response.revision, fromDate: null,
  htmlBody: null, isEnabled: false, subject: null, textBody: null, toDate: null };

const request = (method: "GET" | "PUT", body?: unknown,
  requestOrigin = origin, scope = mailSessionScope(connection)) =>
  new Request(`${origin}/api/v1/member/vacation`, {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }),
      host: "mail.example.test", origin: requestOrigin,
      "x-veda-mail-session-scope": scope }, method,
  });

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getCurrentConnection.mockResolvedValue(connection);
  mocks.getVacationCapability.mockResolvedValue({ supported: true });
  mocks.getVacationResponse.mockResolvedValue(response);
  mocks.getDelegationCapability.mockResolvedValue({ supported: false, reason: "Unavailable" });
  mocks.updateVacationResponse.mockResolvedValue({ ...response, revision: "state-2" });
});

describe("member vacation route", () => {
  it("returns a private capability-gated workspace", async () => {
    const result = await GET(request("GET"));
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    await expect(result.json()).resolves.toMatchObject({ data: {
      capability: { supported: true }, delegation: { supported: false }, response,
    } });
  });

  it("validates and updates with the provider revision", async () => {
    const result = await PUT(request("PUT", update));
    expect(result.status).toBe(200);
    expect(mocks.updateVacationResponse).toHaveBeenCalledWith(update);
  });

  it("rejects stale scope, cross-origin writes, and mass assignment", async () => {
    expect((await GET(request("GET", undefined, origin, "stale"))).status).toBe(409);
    expect((await PUT(request("PUT", update,
      "https://attacker.test"))).status).toBe(403);
    expect((await PUT(request("PUT", { ...update,
      owner: "victim@example.test" }))).status).toBe(400);
  });

  it("bounds bodies and leaves unsupported providers untouched", async () => {
    expect((await PUT(request("PUT", { ...update, expectedRevision: "x",
      textBody: "x".repeat(MAX_VACATION_REQUEST_BYTES) }))).status).toBe(413);
    mocks.getVacationCapability.mockResolvedValueOnce({
      reason: "Unavailable", supported: false,
    });
    expect((await PUT(request("PUT", update))).status).toBe(422);
    expect(mocks.updateVacationResponse).not.toHaveBeenCalled();
  });
});
