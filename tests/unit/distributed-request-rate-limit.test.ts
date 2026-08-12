import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ consume: vi.fn() }));
vi.mock("@/server/security/distributed-rate-limit", () => ({
  consumeDistributedRateLimit: mocks.consume,
}));

import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.consume.mockResolvedValue(undefined);
  process.env["VEDA_MAIL_TRUST_PROXY_HEADERS"] = "true";
});

describe("distributed request rate limits", () => {
  it("charges local plus shared global and trusted-source windows", async () => {
    const request = new Request("https://mail.example.com/api/v1/mail/workspace", {
      headers: { "x-forwarded-for": "198.51.100.17" },
    });
    await assertRequestRateLimit(
      request,
      `mail-read-${crypto.randomUUID()}`,
      100,
      20,
      60_000,
    );
    expect(mocks.consume).toHaveBeenNthCalledWith(1, expect.objectContaining({
      dimension: "global",
      limit: 100,
      subject: "all",
    }));
    expect(mocks.consume).toHaveBeenNthCalledWith(2, expect.objectContaining({
      dimension: "source",
      limit: 20,
      subject: "198.51.100.17",
    }));
  });

  it("forwards weighted subject cost and rejects a shared outage", async () => {
    const failure = Object.assign(new Error("unavailable"), {
      code: "RATE_LIMIT_BACKEND_UNAVAILABLE",
      status: 503,
    });
    mocks.consume.mockRejectedValueOnce(failure);
    await expect(assertSubjectRateLimit(
      `bulk-${crypto.randomUUID()}`,
      " private-member ",
      30,
      60_000,
      7,
    )).rejects.toBe(failure);
    expect(mocks.consume).toHaveBeenCalledWith(expect.objectContaining({
      cost: 7,
      dimension: "subject",
      subject: "private-member",
    }));
  });
});
