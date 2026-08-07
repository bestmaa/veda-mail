import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  consumeDistributedRateLimit,
  resetDistributedRateLimitClientForTests,
} from "@/server/security/distributed-rate-limit";

const redisUrl = process.env["VEDA_MAIL_TEST_REDIS_URL"];

describe.skipIf(!redisUrl)("live Redis authentication rate limit", () => {
  beforeAll(() => {
    process.env["VEDA_MAIL_RATE_LIMIT_REDIS_URL"] = redisUrl;
    process.env["VEDA_MAIL_RATE_LIMIT_REDIS_PREFIX"] =
      `veda-mail:test:${crypto.randomUUID()}`;
  });

  afterAll(() => {
    resetDistributedRateLimitClientForTests();
    delete process.env["VEDA_MAIL_RATE_LIMIT_REDIS_URL"];
    delete process.env["VEDA_MAIL_RATE_LIMIT_REDIS_PREFIX"];
  });

  it("admits only the shared limit under parallel contention", async () => {
    const scope = `member-login-${crypto.randomUUID()}`;
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, () => consumeDistributedRateLimit({
        dimension: "subject",
        durationMs: 60_000,
        limit: 3,
        scope,
        subject: "same-member@example.com",
      })),
    );

    expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(3);
    const rejected = attempts.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected).toHaveLength(5);
    expect(rejected.every(({ reason }) =>
      reason instanceof Error && "code" in reason && reason.code === "RATE_LIMITED",
    )).toBe(true);
  });
});
