import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ clients: [] as Array<{
  connect: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  eval: ReturnType<typeof vi.fn>;
  isReady: boolean;
  on: ReturnType<typeof vi.fn>;
  ping: ReturnType<typeof vi.fn>;
}> }));

vi.mock("redis", () => ({
  createClient: vi.fn(() => {
    const client = {
      connect: vi.fn(), destroy: vi.fn(), eval: vi.fn(),
      isReady: false, on: vi.fn(), ping: vi.fn().mockResolvedValue("PONG"),
    };
    client.connect.mockImplementation(async () => {
      client.isReady = true;
      return client;
    });
    client.eval.mockResolvedValue(1);
    mocks.clients.push(client);
    return client;
  }),
}));
vi.mock("@/server/security-audit/security-audit-key", () => ({
  securityAuditSubkey: () => Buffer.alloc(32, 7),
}));

import {
  consumeDistributedRateLimit,
  probeDistributedRateLimit,
  resetDistributedRateLimitClientForTests,
} from "@/server/security/distributed-rate-limit";

beforeEach(() => {
  mocks.clients.length = 0;
  process.env["VEDA_MAIL_RATE_LIMIT_REDIS_URL"] = "redis://redis.internal:6379";
  resetDistributedRateLimitClientForTests();
});

afterEach(() => {
  resetDistributedRateLimitClientForTests();
  delete process.env["VEDA_MAIL_RATE_LIMIT_REDIS_URL"];
  delete process.env["VEDA_MAIL_RATE_LIMIT_REDIS_PREFIX"];
});

const consume = () => consumeDistributedRateLimit({
  dimension: "subject",
  durationMs: 60_000,
  limit: 5,
  scope: "member-login",
  subject: "private@example.com",
});

describe("distributed authentication rate limit", () => {
  it("uses an opaque Redis key and an atomic fixed-window script", async () => {
    await consume();
    const evaluation = mocks.clients[0]?.eval.mock.calls[0];
    expect(evaluation?.[0]).toContain("INCRBY");
    expect(evaluation?.[0]).toContain("PEXPIRE");
    expect(JSON.stringify(evaluation?.[1])).not.toContain("private@example.com");
  });

  it("rejects a limit overflow", async () => {
    await consume();
    mocks.clients[0]?.eval.mockResolvedValueOnce(6);
    await expect(consume()).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });
  });

  it("fails closed when the configured shared backend is unavailable", async () => {
    await consume();
    mocks.clients[0]?.eval.mockRejectedValueOnce(new Error("offline"));
    await expect(consume()).rejects.toMatchObject({
      code: "RATE_LIMIT_BACKEND_UNAVAILABLE", status: 503,
    });
    expect(mocks.clients[0]?.destroy).toHaveBeenCalled();
  });

  it("is a no-op when no shared backend was configured", async () => {
    delete process.env["VEDA_MAIL_RATE_LIMIT_REDIS_URL"];
    await expect(consume()).resolves.toBeUndefined();
    expect(mocks.clients).toHaveLength(0);
  });

  it("rejects an unsafe deployment key prefix", async () => {
    process.env["VEDA_MAIL_RATE_LIMIT_REDIS_PREFIX"] = "unsafe prefix";
    await expect(consume()).rejects.toMatchObject({
      code: "RATE_LIMIT_BACKEND_UNAVAILABLE", status: 503,
    });
  });

  it("probes the configured shared dependency for readiness", async () => {
    await expect(probeDistributedRateLimit()).resolves.toBeUndefined();
    expect(mocks.clients[0]?.ping).toHaveBeenCalledOnce();
    mocks.clients[0]?.ping.mockRejectedValueOnce(new Error("offline"));
    await expect(probeDistributedRateLimit()).rejects.toMatchObject({
      code: "RATE_LIMIT_BACKEND_UNAVAILABLE",
      status: 503,
    });
  });
});
