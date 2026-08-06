import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_MAIL_CONTENT_POLICY } from "@/domain/installation/mail-content-policy";

const mocks = vi.hoisted(() => ({
  assertAdminAccess: vi.fn(), assertRequestRateLimit: vi.fn(),
  assertSubjectRateLimit: vi.fn(), get: vi.fn(), put: vi.fn(),
}));
vi.mock("@/server/auth/admin-session", () => ({ assertAdminAccess: mocks.assertAdminAccess }));
vi.mock("@/server/organization/mail-content-policy.store", () => ({
  mailContentPolicyStore: { get: mocks.get, put: mocks.put },
}));
vi.mock("@/server/security/rate-limit", () => ({
  assertRequestRateLimit: mocks.assertRequestRateLimit,
  assertSubjectRateLimit: mocks.assertSubjectRateLimit,
}));

import { GET, PUT } from "@/app/api/v1/admin/mail-policy/route";

const request = (body: unknown, origin = "https://mail.example.com") => new Request(
  "https://mail.example.com/api/v1/admin/mail-policy",
  { body: JSON.stringify(body), headers: { "content-type": "application/json", host: "mail.example.com", origin }, method: "PUT" },
);

beforeEach(() => {
  vi.clearAllMocks(); mocks.get.mockResolvedValue(DEFAULT_MAIL_CONTENT_POLICY);
  mocks.put.mockResolvedValue(DEFAULT_MAIL_CONTENT_POLICY);
});

describe("admin mail policy route", () => {
  it("returns policy only to an authenticated administrator", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { policy: DEFAULT_MAIL_CONTENT_POLICY } });
    expect(mocks.assertAdminAccess).toHaveBeenCalledOnce();
  });

  it("validates and saves a strict complete policy", async () => {
    const policy = { ...DEFAULT_MAIL_CONTENT_POLICY, blockedExtensions: ["exe"] };
    const response = await PUT(request(policy));
    expect(response.status).toBe(200);
    expect(mocks.put).toHaveBeenCalledWith(policy);
  });

  it("rejects unknown keys and cross-origin writes before persistence", async () => {
    expect((await PUT(request({ ...DEFAULT_MAIL_CONTENT_POLICY, hidden: true }))).status).toBe(400);
    expect((await PUT(request(DEFAULT_MAIL_CONTENT_POLICY, "https://attacker.example"))).status).toBe(403);
    expect(mocks.put).not.toHaveBeenCalled();
  });
});
