import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { adminSessionStore } from "@/server/auth/admin-session-store";
import { resetSharedStateRedisClientForTests } from
  "@/server/shared-state/shared-state-redis";

const originalJobKey = process.env["VEDA_MAIL_JOB_KEY"];
const originalUrl = process.env["VEDA_MAIL_STATE_REDIS_URL"];

beforeEach(() => {
  process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 31).toString("base64");
});

afterEach(() => {
  resetSharedStateRedisClientForTests();
  if (originalJobKey === undefined) delete process.env["VEDA_MAIL_JOB_KEY"];
  else process.env["VEDA_MAIL_JOB_KEY"] = originalJobKey;
  if (originalUrl === undefined) delete process.env["VEDA_MAIL_STATE_REDIS_URL"];
  else process.env["VEDA_MAIL_STATE_REDIS_URL"] = originalUrl;
});

describe("shared session Redis configuration", () => {
  it("fails closed when the configured URL is not Redis", async () => {
    process.env["VEDA_MAIL_STATE_REDIS_URL"] = "https://redis.example.com";
    await expect(adminSessionStore.getAsync("session", 1)).rejects.toMatchObject({
      code: "SESSION_BACKEND_UNAVAILABLE",
      status: 503,
    });
  });
});
