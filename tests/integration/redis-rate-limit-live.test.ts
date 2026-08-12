import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  consumeDistributedRateLimit,
  probeDistributedRateLimit,
  resetDistributedRateLimitClientForTests,
} from "@/server/security/distributed-rate-limit";

const redisUrl = process.env["VEDA_MAIL_TEST_REDIS_URL"];
const originalJobKey = process.env["VEDA_MAIL_JOB_KEY"];

describe.skipIf(!redisUrl)("live Redis request rate limits", () => {
  beforeAll(() => {
    process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 61).toString("base64");
    process.env["VEDA_MAIL_RATE_LIMIT_REDIS_URL"] = redisUrl;
    process.env["VEDA_MAIL_RATE_LIMIT_REDIS_PREFIX"] =
      `veda-mail:test:${crypto.randomUUID()}`;
  });

  afterAll(() => {
    resetDistributedRateLimitClientForTests();
    delete process.env["VEDA_MAIL_RATE_LIMIT_REDIS_URL"];
    delete process.env["VEDA_MAIL_RATE_LIMIT_REDIS_PREFIX"];
    if (originalJobKey === undefined) delete process.env["VEDA_MAIL_JOB_KEY"];
    else process.env["VEDA_MAIL_JOB_KEY"] = originalJobKey;
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

  it("atomically enforces weighted work and answers readiness", async () => {
    await expect(probeDistributedRateLimit()).resolves.toBeUndefined();
    const scope = `mail-bulk-${crypto.randomUUID()}`;
    await consumeDistributedRateLimit({
      cost: 4,
      dimension: "subject",
      durationMs: 60_000,
      limit: 10,
      scope,
      subject: "same-mailbox",
    });
    resetDistributedRateLimitClientForTests();
    await consumeDistributedRateLimit({
      cost: 6,
      dimension: "subject",
      durationMs: 60_000,
      limit: 10,
      scope,
      subject: "same-mailbox",
    });
    resetDistributedRateLimitClientForTests();
    await expect(consumeDistributedRateLimit({
      cost: 1,
      dimension: "subject",
      durationMs: 60_000,
      limit: 10,
      scope,
      subject: "same-mailbox",
    })).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });
  });
});
