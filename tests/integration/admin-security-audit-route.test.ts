import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAdminAccess: vi.fn(),
  assertRequestRateLimit: vi.fn(),
  assertSubjectRateLimit: vi.fn(),
  list: vi.fn(),
}));
vi.mock("@/server/auth/admin-session", () => ({
  assertAdminAccess: mocks.assertAdminAccess,
}));
vi.mock("@/server/security-audit/security-audit.store", () => ({
  securityAuditStore: { list: mocks.list },
}));
vi.mock("@/server/security/rate-limit", () => ({
  assertRequestRateLimit: mocks.assertRequestRateLimit,
  assertSubjectRateLimit: mocks.assertSubjectRateLimit,
}));

import { GET } from "@/app/api/v1/admin/audit/route";

const request = (query = "") => new Request(
  `https://mail.example.com/api/v1/admin/audit${query}`,
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue({
    droppedCount: 0, entries: [], nextCursor: null,
    verifiedAt: "2026-08-06T00:00:00.000Z",
  });
});

describe("administrator security audit route", () => {
  it("returns a verified bounded page only after administrator access", async () => {
    const response = await GET(request("?beforeSequence=42&limit=25"));
    expect(response.status).toBe(200);
    expect(mocks.assertAdminAccess).toHaveBeenCalledOnce();
    expect(mocks.list).toHaveBeenCalledWith({ beforeSequence: 42, limit: 25 });
  });

  it.each([
    "?limit=0",
    "?limit=201",
    "?beforeSequence=-1",
    "?unknown=true",
    "?limit=20&limit=30",
  ])("rejects an unsafe query: %s", async (query) => {
    expect((await GET(request(query))).status).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("does not read the store when administrator access fails", async () => {
    mocks.assertAdminAccess.mockRejectedValue(new Error("denied"));
    expect((await GET(request())).status).toBe(500);
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
