import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  append: vi.fn(), applyRetention: vi.fn(), assertAdminAccess: vi.fn(), get: vi.fn(), put: vi.fn(),
}));
vi.mock("@/server/auth/admin-session", () => ({ assertAdminAccess: mocks.assertAdminAccess }));
vi.mock("@/server/organization/data-retention-policy.store", () => ({
  dataRetentionPolicyStore: { get: mocks.get, put: mocks.put },
}));
vi.mock("@/server/security-audit/security-audit.store", () => ({
  securityAuditStore: { applyRetention: mocks.applyRetention },
}));
vi.mock("@/server/security/rate-limit", () => ({
  assertRequestRateLimit: vi.fn(), assertSubjectRateLimit: vi.fn(),
}));
vi.mock("@/server/security-audit/security-audit", () => ({
  appendSecurityAudit: mocks.append,
  installationAdministratorAuditActor: vi.fn(() => ({ actorId: "audit", actorType: "administrator" })),
}));

import { GET, PUT } from "@/app/api/v1/admin/retention/route";

const policy = { securityAuditMaxAgeDays: 90, securityAuditMaxEntries: 2_000 };
const request = (body: unknown, origin = "https://mail.example.com") => new Request(
  "https://mail.example.com/api/v1/admin/retention",
  { body: JSON.stringify(body), headers: { "content-type": "application/json", host: "mail.example.com", origin }, method: "PUT" },
);
beforeEach(() => {
  vi.clearAllMocks(); mocks.get.mockResolvedValue(policy); mocks.put.mockResolvedValue(policy);
});

describe("administrator data-retention route", () => {
  it("returns the authenticated policy", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { policy } });
  });

  it("persists a strict policy and immediately applies it", async () => {
    const response = await PUT(request(policy));
    expect(response.status).toBe(200);
    expect(mocks.put).toHaveBeenCalledWith(policy);
    expect(mocks.applyRetention).toHaveBeenCalledOnce();
    expect(mocks.append).toHaveBeenNthCalledWith(1, expect.objectContaining({
      action: "admin.retention.updated", outcome: "attempt", targetType: "retention",
    }));
    expect(mocks.append).toHaveBeenNthCalledWith(2, expect.objectContaining({ outcome: "success" }));
  });

  it.each([
    { securityAuditMaxAgeDays: 0, securityAuditMaxEntries: 2_000 },
    { securityAuditMaxAgeDays: 90, securityAuditMaxEntries: 99 },
    { ...policy, unknown: true },
  ])("rejects unsafe policy %#", async (unsafe) => {
    expect((await PUT(request(unsafe))).status).toBe(400);
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("rejects cross-origin changes before admin and storage access", async () => {
    expect((await PUT(request(policy, "https://attacker.example"))).status).toBe(403);
    expect(mocks.assertAdminAccess).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
  });
});
