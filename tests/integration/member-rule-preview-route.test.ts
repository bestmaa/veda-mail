import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertRequestRateLimit: vi.fn(),
  assertSubjectRateLimit: vi.fn(),
  getCurrentConnection: vi.fn(),
  previewMailRules: vi.fn(),
}));

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.getCurrentConnection,
}));
vi.mock("@/server/security/rate-limit", () => ({
  assertRequestRateLimit: mocks.assertRequestRateLimit,
  assertSubjectRateLimit: mocks.assertSubjectRateLimit,
}));
vi.mock("@/server/rules/rule-preview.service", () => ({
  previewMailRules: mocks.previewMailRules,
}));

import { POST } from "@/app/api/v1/member/rules/preview/route";
import { id } from "@/domain/shared/brand";
import { mailSessionScope } from "@/server/connections/mail-session-scope";

const origin = "https://mail.example.com";
const connection = {
  config: {}, createdAt: "2026-08-04T00:00:00.000Z", displayName: "Mail",
  id: id.connection("preview-connection"), providerId: id.provider("mock"),
};
const rule = {
  actions: [{ kind: "star" }],
  conditions: [{ kind: "subject", operator: "contains", value: "invoice" }],
  createdAt: "2026-08-04T00:00:00.000Z", enabled: true,
  id: "11111111-1111-4111-8111-111111111111", match: "all",
  name: "Invoices", stopProcessing: false,
  updatedAt: "2026-08-04T00:00:00.000Z",
};
const request = (body: unknown, requestOrigin = origin, scope = mailSessionScope(connection)) =>
  new Request(`${origin}/api/v1/member/rules/preview`, {
    body: JSON.stringify(body), headers: {
      "content-type": "application/json", host: "mail.example.com",
      origin: requestOrigin, "x-veda-mail-session-scope": scope,
    }, method: "POST",
  });

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.getCurrentConnection.mockResolvedValue(connection);
  mocks.previewMailRules.mockResolvedValue([]);
});

describe("member rule preview route", () => {
  it("previews a strict, bounded rule set without caching", async () => {
    const input = { limit: 25, rules: [rule] };
    const response = await POST(request(input));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.previewMailRules).toHaveBeenCalledWith(connection, input);
  });

  it("rejects cross-origin, stale-scope, and mass-assigned requests", async () => {
    expect((await POST(request({ limit: 1, rules: [] },
      "https://attacker.example"))).status).toBe(403);
    expect((await POST(request({ limit: 1, rules: [] }, origin, "stale"))).status)
      .toBe(409);
    expect((await POST(request({ limit: 1, owner: "victim", rules: [] }))).status)
      .toBe(400);
    expect(mocks.previewMailRules).not.toHaveBeenCalled();
  });

  it("rejects limits above one hundred before reading the provider", async () => {
    const response = await POST(request({ limit: 101, rules: [] }));
    expect(response.status).toBe(400);
    expect(mocks.previewMailRules).not.toHaveBeenCalled();
  });
});
