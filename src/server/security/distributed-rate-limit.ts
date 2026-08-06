import "server-only";

import { createHmac } from "node:crypto";
import { createClient } from "redis";

import { securityAuditSubkey } from "@/server/security-audit/security-audit-key";
import { ApiError } from "@/transport/http/api-error";

const WINDOW_SCRIPT = `
local count = redis.call('INCRBY', KEYS[1], ARGV[1])
if count == tonumber(ARGV[1]) then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return count
`;

const createRedisClient = (url: string) => createClient({
  socket: { connectTimeout: 2_000, reconnectStrategy: false },
  url,
});
type Client = ReturnType<typeof createRedisClient>;
const globalState = globalThis as typeof globalThis & {
  __vedaMailRateLimitRedisClient?: Client;
  __vedaMailRateLimitRedisPromise?: Promise<Client>;
};

const backendUnavailable = (): never => {
  throw new ApiError(
    "Sign-in protection is temporarily unavailable.",
    "RATE_LIMIT_BACKEND_UNAVAILABLE",
    503,
  );
};

const redisUrl = (): string | null => {
  const value = process.env["VEDA_MAIL_RATE_LIMIT_REDIS_URL"]?.trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (!["redis:", "rediss:"].includes(parsed.protocol)) backendUnavailable();
    return value;
  } catch {
    return backendUnavailable();
  }
};

const client = async (): Promise<Client | null> => {
  const url = redisUrl();
  if (!url) return null;
  if (globalState.__vedaMailRateLimitRedisClient?.isReady) {
    return globalState.__vedaMailRateLimitRedisClient;
  }
  if (globalState.__vedaMailRateLimitRedisPromise) {
    return globalState.__vedaMailRateLimitRedisPromise;
  }
  const next = createRedisClient(url);
  next.on("error", () => undefined);
  const pending = next.connect().then(() => {
    globalState.__vedaMailRateLimitRedisClient = next;
    return next;
  }).catch(() => {
    next.destroy();
    return backendUnavailable();
  }).finally(() => {
    delete globalState.__vedaMailRateLimitRedisPromise;
  });
  globalState.__vedaMailRateLimitRedisPromise = pending;
  return pending;
};

const keyFor = (scope: string, dimension: string, subject: string): string => {
  const digest = createHmac("sha256", securityAuditSubkey("distributed-rate-limit"))
    .update(scope).update("\0").update(dimension).update("\0").update(subject)
    .digest("base64url");
  const prefix = process.env["VEDA_MAIL_RATE_LIMIT_REDIS_PREFIX"]?.trim()
    || "veda-mail:rate-limit:v1";
  if (!/^[A-Za-z0-9:_-]{1,80}$/u.test(prefix)) backendUnavailable();
  return `${prefix}:${digest}`;
};

export const consumeDistributedRateLimit = async (input: {
  readonly cost?: number;
  readonly dimension: "global" | "source" | "subject";
  readonly durationMs: number;
  readonly limit: number;
  readonly scope: string;
  readonly subject: string;
}): Promise<void> => {
  const activeClient = await client();
  if (!activeClient) return;
  try {
    const count = await activeClient.eval(WINDOW_SCRIPT, {
      arguments: [String(input.cost ?? 1), String(input.durationMs)],
      keys: [keyFor(input.scope, input.dimension, input.subject)],
    });
    if (Number(count) > input.limit) {
      throw new ApiError(
        "Too many requests. Please wait and try again.",
        "RATE_LIMITED",
        429,
      );
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    activeClient.destroy();
    delete globalState.__vedaMailRateLimitRedisClient;
    backendUnavailable();
  }
};

export const resetDistributedRateLimitClientForTests = (): void => {
  globalState.__vedaMailRateLimitRedisClient?.destroy();
  delete globalState.__vedaMailRateLimitRedisClient;
  delete globalState.__vedaMailRateLimitRedisPromise;
};
