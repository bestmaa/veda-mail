import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consume: vi.fn(),
  request: vi.fn(),
  source: vi.fn(),
  subject: vi.fn(),
}));
vi.mock("@/server/security/distributed-rate-limit", () => ({
  consumeDistributedRateLimit: mocks.consume,
}));
vi.mock("@/server/security/rate-limit", () => ({
  assertRequestRateLimit: mocks.request,
  assertSubjectRateLimit: mocks.subject,
  rateLimitSourceFor: mocks.source,
}));

import {
  assertAuthenticationRequestRateLimit,
  assertAuthenticationSubjectRateLimit,
} from "@/server/security/authentication-rate-limit";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.consume.mockResolvedValue(undefined);
  mocks.source.mockReturnValue("203.0.113.7");
});

describe("authentication rate-limit orchestration", () => {
  it("enforces local and shared global/source windows", async () => {
    const request = new Request("https://mail.example.com/api/v1/member/session");
    await assertAuthenticationRequestRateLimit(request, "member-login", 100, 20, 60_000);
    expect(mocks.request).toHaveBeenCalledWith(request, "member-login", 100, 20, 60_000);
    expect(mocks.consume).toHaveBeenCalledWith(expect.objectContaining({
      dimension: "global", limit: 100, subject: "all",
    }));
    expect(mocks.consume).toHaveBeenCalledWith(expect.objectContaining({
      dimension: "source", limit: 20, subject: "203.0.113.7",
    }));
  });

  it("normalizes identity only inside the privacy-safe subject limiter", async () => {
    await assertAuthenticationSubjectRateLimit(
      "admin-login", " Owner@Example.COM ", 8, 60_000,
    );
    expect(mocks.subject).toHaveBeenCalledWith(
      "admin-login", " Owner@Example.COM ", 8, 60_000,
    );
    expect(mocks.consume).toHaveBeenCalledWith(expect.objectContaining({
      dimension: "subject", subject: "owner@example.com",
    }));
  });
});
