import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAdminAccess: vi.fn(),
  assertRequestRateLimit: vi.fn(),
  assertSubjectRateLimit: vi.fn(),
  getAdminCapabilitySnapshot: vi.fn(),
  putOrganizationPolicy: vi.fn(),
}));

vi.mock("@/server/auth/admin-session", () => ({
  assertAdminAccess: mocks.assertAdminAccess,
}));
vi.mock("@/server/organization/organization-policy.store", () => ({
  organizationPolicyStore: {
    put: mocks.putOrganizationPolicy,
  },
}));
vi.mock("@/server/organization/organization-policy.service", () => ({
  getAdminCapabilitySnapshot: mocks.getAdminCapabilitySnapshot,
}));
vi.mock("@/server/security/rate-limit", () => ({
  assertRequestRateLimit: mocks.assertRequestRateLimit,
  assertSubjectRateLimit: mocks.assertSubjectRateLimit,
}));

import { GET, PUT } from "@/app/api/v1/admin/capabilities/route";

const policy = {
  memberPasswordChange: false,
  memberProfileEditing: true,
  memberTwoFactorEnrollment: false,
};
const snapshot = {
  capabilities: [],
  policy,
  provider: { id: "stalwart-jmap", name: "Stalwart JMAP" },
};

const request = (body: unknown, origin = "https://mail.example.com") =>
  new Request("https://mail.example.com/api/v1/admin/capabilities", {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      host: "mail.example.com",
      origin,
    },
    method: "PUT",
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAdminCapabilitySnapshot.mockResolvedValue(snapshot);
  mocks.putOrganizationPolicy.mockResolvedValue(policy);
});

describe("admin capability policy route", () => {
  it("returns only the capability snapshot to an authenticated admin", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: snapshot });
    expect(mocks.assertAdminAccess).toHaveBeenCalledOnce();
  });

  it("validates and atomically saves the complete strict policy", async () => {
    const response = await PUT(request(policy));

    expect(response.status).toBe(200);
    expect(mocks.putOrganizationPolicy).toHaveBeenCalledWith(policy);
    expect(mocks.assertRequestRateLimit).toHaveBeenCalledOnce();
    expect(mocks.assertSubjectRateLimit).toHaveBeenCalledOnce();
  });

  it("rejects unknown policy keys before persistence", async () => {
    const response = await PUT(request({ ...policy, administrator: true }));

    expect(response.status).toBe(400);
    expect(mocks.putOrganizationPolicy).not.toHaveBeenCalled();
  });

  it("rejects cross-origin mutations before admin or persistence work", async () => {
    const response = await PUT(request(policy, "https://attacker.example"));

    expect(response.status).toBe(403);
    expect(mocks.assertAdminAccess).not.toHaveBeenCalled();
    expect(mocks.putOrganizationPolicy).not.toHaveBeenCalled();
  });
});
