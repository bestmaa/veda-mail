import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertRequestRateLimit: vi.fn(),
  assertSubjectRateLimit: vi.fn(),
  getCurrentConnection: vi.fn(),
  mutateAndDeployRules: vi.fn(),
  readRuleWorkspace: vi.fn(),
  reconcileRules: vi.fn(),
}));

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.getCurrentConnection,
}));
vi.mock("@/server/security/rate-limit", () => ({
  assertRequestRateLimit: mocks.assertRequestRateLimit,
  assertSubjectRateLimit: mocks.assertSubjectRateLimit,
}));
vi.mock("@/server/rules/rule-deployment.service", () => ({
  mutateAndDeployRules: mocks.mutateAndDeployRules,
  readRuleWorkspace: mocks.readRuleWorkspace,
  reconcileRules: mocks.reconcileRules,
}));

import { GET, PUT } from "@/app/api/v1/member/rules/route";
import { POST } from "@/app/api/v1/member/rules/reconcile/route";
import { MAX_MAIL_RULE_REQUEST_BYTES } from "@/domain/mail/rule";
import { id } from "@/domain/shared/brand";
import { mailSessionScope } from "@/server/connections/mail-session-scope";

const origin = "https://mail.example.com";
const connection = {
  config: {}, createdAt: "2026-08-04T00:00:00.000Z", displayName: "Mail",
  id: id.connection("rule-route-connection"), providerId: id.provider("mock"),
};
const revision = "11111111-1111-4111-8111-111111111111";
const definition = {
  actions: [{ kind: "star" }],
  conditions: [{ kind: "subject", operator: "contains", value: "invoice" }],
  enabled: true, match: "all", name: "Invoices", stopProcessing: false,
};

const request = (
  path: string,
  method: "GET" | "POST" | "PUT",
  body?: unknown,
  requestOrigin = origin,
  scope = mailSessionScope(connection),
) => new Request(`${origin}${path}`, {
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  headers: {
    ...(body === undefined ? {} : { "content-type": "application/json" }),
    host: "mail.example.com", origin: requestOrigin,
    "x-veda-mail-session-scope": scope,
  },
  method,
});

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getCurrentConnection.mockResolvedValue(connection);
  mocks.readRuleWorkspace.mockResolvedValue({
    book: { audit: [], deployment: { status: "undeployed" }, revision: null,
      rules: [], version: 1 },
    capability: { supported: true },
  });
  mocks.mutateAndDeployRules.mockResolvedValue({ revision, rules: [] });
  mocks.reconcileRules.mockResolvedValue({ revision, rules: [] });
});

describe("member rule routes", () => {
  it("loads a private rule workspace and deploys strict mutations", async () => {
    const loaded = await GET(request("/api/v1/member/rules", "GET"));
    expect(loaded.status).toBe(200);
    expect(loaded.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.readRuleWorkspace).toHaveBeenCalledWith(connection);

    const operation = { definition, expectedRevision: null, operation: "create" };
    const changed = await PUT(request("/api/v1/member/rules", "PUT", operation));
    expect(changed.status).toBe(201);
    expect(mocks.mutateAndDeployRules).toHaveBeenCalledWith(connection, operation);
  });

  it("retries an undeployed revision through the reconcile endpoint", async () => {
    const response = await POST(request(
      "/api/v1/member/rules/reconcile", "POST", { expectedRevision: revision },
    ));
    expect(response.status).toBe(200);
    expect(mocks.reconcileRules).toHaveBeenCalledWith(connection, revision);
  });

  it("rejects stale scope, cross-origin writes, and mass assignment", async () => {
    expect((await GET(request("/api/v1/member/rules", "GET", undefined,
      origin, "stale"))).status).toBe(409);
    expect((await PUT(request("/api/v1/member/rules", "PUT", {
      definition, expectedRevision: null, operation: "create",
    }, "https://attacker.example"))).status).toBe(403);
    expect((await PUT(request("/api/v1/member/rules", "PUT", {
      definition, expectedRevision: null, operation: "create",
      ownerEmail: "victim@example.com",
    }))).status).toBe(400);
  });

  it("bounds mutation bodies before deployment", async () => {
    const response = await PUT(request("/api/v1/member/rules", "PUT", {
      definition: { ...definition, name: "x".repeat(MAX_MAIL_RULE_REQUEST_BYTES) },
      expectedRevision: null, operation: "create",
    }));
    expect(response.status).toBe(413);
    expect(mocks.mutateAndDeployRules).not.toHaveBeenCalled();
  });
});
