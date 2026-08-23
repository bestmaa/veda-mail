import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertScope: vi.fn(), getConnection: vi.fn(), read: vi.fn(),
  requestRate: vi.fn(), subjectRate: vi.fn(),
}));

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.getConnection,
}));
vi.mock("@/server/connections/mail-session-scope", () => ({
  assertMailSessionScope: mocks.assertScope,
}));
vi.mock("@/server/mail-forwarding/member-mail-forwarding", () => ({
  readMemberMailForwarding: mocks.read,
}));
vi.mock("@/server/security/rate-limit", () => ({
  assertRequestRateLimit: mocks.requestRate, assertSubjectRateLimit: mocks.subjectRate,
}));

import { GET } from "@/app/api/v1/member/forwarding/route";
import { ApiError } from "@/transport/http/api-error";

const connection = { id: "connection-1" };
const request = () => new Request("https://webmail.example.com/api/v1/member/forwarding", {
  headers: { "x-veda-mail-session-scope": "scope" },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getConnection.mockResolvedValue(connection);
  mocks.read.mockResolvedValue({
    destinationEmail: "ada@gmail.com", enabled: true,
    keepLocalCopy: true, status: "active",
  });
});

describe("member forwarding visibility route", () => {
  it("returns only read-only forwarding state for the current scoped session", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.assertScope).toHaveBeenCalledWith(expect.any(Request), connection);
    expect(mocks.subjectRate).toHaveBeenCalledWith(
      "member-forwarding-read", "connection-1", 120, 60_000,
    );
    expect(mocks.read).toHaveBeenCalledWith(connection);
    await expect(response.json()).resolves.toEqual({ data: {
      destinationEmail: "ada@gmail.com", enabled: true,
      keepLocalCopy: true, status: "active",
    } });
  });

  it("fails closed on a stale session scope before reading forwarding data", async () => {
    mocks.assertScope.mockImplementationOnce(() => {
      throw new ApiError("Reconnect.", "MAIL_SESSION_SCOPE_STALE", 409);
    });
    const response = await GET(request());
    expect(response.status).toBe(409);
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
