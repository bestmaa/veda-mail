import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_MESSAGE_LIST_PREFERENCES } from "@/domain/mail/message-list-preferences";
import { id } from "@/domain/shared/brand";
import { mailSessionScope } from "@/server/connections/mail-session-scope";

const mocks = vi.hoisted(() => ({
  appendSecurityAudit: vi.fn(),
  assertRequestRateLimit: vi.fn(),
  assertSubjectRateLimit: vi.fn(),
  exportPortableSettings: vi.fn(),
  getCurrentConnection: vi.fn(),
  importPortableSettings: vi.fn(),
}));

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.getCurrentConnection,
}));
vi.mock("@/server/portability/settings-portability.service", () => ({
  exportPortableSettings: mocks.exportPortableSettings,
  importPortableSettings: mocks.importPortableSettings,
}));
vi.mock("@/server/security/rate-limit", () => ({
  assertRequestRateLimit: mocks.assertRequestRateLimit,
  assertSubjectRateLimit: mocks.assertSubjectRateLimit,
}));
vi.mock("@/server/security-audit/security-audit", () => ({
  appendSecurityAudit: mocks.appendSecurityAudit,
  memberAuditActor: vi.fn(() => ({ actorId: "audit", actorType: "member" })),
}));

import {
  GET,
  POST,
} from "@/app/api/v1/member/portability/settings/route";

const origin = "https://mail.example.com";
const connection = {
  config: {},
  createdAt: "2026-08-12T00:00:00.000Z",
  displayName: "Mail",
  id: id.connection("settings-portability-connection"),
  providerId: id.provider("mock"),
};
const bundle = {
  exportedAt: "2026-08-12T00:00:00.000Z",
  format: "veda-mail/settings" as const,
  preferences: DEFAULT_MESSAGE_LIST_PREFERENCES,
  rules: [{
    actions: [{ kind: "star" as const }],
    conditions: [{ kind: "subject" as const, operator: "contains" as const, value: "invoice" }],
    enabled: true,
    match: "all" as const,
    name: "Invoices",
    stopProcessing: false,
  }],
  version: 1 as const,
};
const request = (
  method: "GET" | "POST",
  body?: unknown,
  requestOrigin = origin,
  scope = mailSessionScope(connection),
) => new Request(`${origin}/api/v1/member/portability/settings`, {
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  headers: {
    ...(body === undefined ? {} : { "content-type": "application/json" }),
    host: "mail.example.com",
    origin: requestOrigin,
    "x-veda-mail-session-scope": scope,
  },
  method,
});

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getCurrentConnection.mockResolvedValue(connection);
  mocks.exportPortableSettings.mockResolvedValue(bundle);
  mocks.importPortableSettings.mockResolvedValue({
    preferences: bundle.preferences,
    rules: { revision: "revision", rules: [], version: 1 },
  });
});

describe("member settings portability route", () => {
  it("exports a bounded no-store JSON attachment without provider identifiers", async () => {
    const response = await GET(request("GET"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition"))
      .toContain("veda-mail-settings.json");
    expect(response.headers.get("content-security-policy"))
      .toBe("default-src 'none'; sandbox");
    expect(await response.json()).toEqual(bundle);
    expect(mocks.appendSecurityAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "member.settings.exported", count: 1, outcome: "success",
    }));
  });

  it("validates and imports a portable settings file with audited outcomes", async () => {
    const response = await POST(request("POST", bundle));
    expect(response.status).toBe(200);
    expect(mocks.importPortableSettings).toHaveBeenCalledWith(connection, bundle);
    expect(mocks.appendSecurityAudit).toHaveBeenNthCalledWith(1, expect.objectContaining({
      action: "member.settings.imported", outcome: "attempt",
    }));
    expect(mocks.appendSecurityAudit).toHaveBeenNthCalledWith(2, expect.objectContaining({
      action: "member.settings.imported", outcome: "success",
    }));
  });

  it("rejects malformed, stale-scope, and cross-origin imports before mutation", async () => {
    expect((await POST(request("POST", { ...bundle, version: 2 }))).status)
      .toBe(400);
    expect((await POST(request("POST", bundle, origin, "stale"))).status)
      .toBe(409);
    expect((await POST(request("POST", bundle, "https://attacker.example"))).status)
      .toBe(403);
    expect(mocks.importPortableSettings).not.toHaveBeenCalled();
  });
});
