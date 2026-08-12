import "server-only";

import { createClient } from "redis";

import { ApiError } from "@/transport/http/api-error";

const createSharedStateClient = (url: string) => createClient({
  socket: { connectTimeout: 2_000, reconnectStrategy: false },
  url,
});

export type SharedStateRedisClient = ReturnType<typeof createSharedStateClient>;

const globalState = globalThis as typeof globalThis & {
  __vedaMailSharedStateRedisClient?: SharedStateRedisClient;
  __vedaMailSharedStateRedisPromise?: Promise<SharedStateRedisClient>;
};

export const sharedStateUnavailable = (): never => {
  throw new ApiError(
    "Shared session storage is temporarily unavailable.",
    "SESSION_BACKEND_UNAVAILABLE",
    503,
  );
};

const configuredUrl = (): string | null => {
  const value = process.env["VEDA_MAIL_STATE_REDIS_URL"]?.trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (!["redis:", "rediss:"].includes(parsed.protocol)) {
      return sharedStateUnavailable();
    }
    return value;
  } catch {
    return sharedStateUnavailable();
  }
};

export const sharedStateRedisConfigured = (): boolean =>
  Boolean(process.env["VEDA_MAIL_STATE_REDIS_URL"]?.trim());

export const sharedStateRedisPrefix = (): string => {
  const prefix = process.env["VEDA_MAIL_STATE_REDIS_PREFIX"]?.trim()
    || "veda-mail:state:v1";
  if (!/^[A-Za-z0-9:_-]{1,80}$/u.test(prefix)) sharedStateUnavailable();
  return prefix;
};

export const sharedStateRedisClient = async (
): Promise<SharedStateRedisClient | null> => {
  const url = configuredUrl();
  if (!url) return null;
  if (globalState.__vedaMailSharedStateRedisClient?.isReady) {
    return globalState.__vedaMailSharedStateRedisClient;
  }
  if (globalState.__vedaMailSharedStateRedisPromise) {
    return globalState.__vedaMailSharedStateRedisPromise;
  }
  const next = createSharedStateClient(url);
  next.on("error", () => undefined);
  const pending = next.connect().then(() => {
    globalState.__vedaMailSharedStateRedisClient = next;
    return next;
  }).catch(() => {
    next.destroy();
    return sharedStateUnavailable();
  }).finally(() => {
    delete globalState.__vedaMailSharedStateRedisPromise;
  });
  globalState.__vedaMailSharedStateRedisPromise = pending;
  return pending;
};

export const runSharedStateRedis = async <T>(
  operation: (client: SharedStateRedisClient) => Promise<T>,
): Promise<T | null> => {
  const client = await sharedStateRedisClient();
  if (!client) return null;
  try {
    return await operation(client);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    client.destroy();
    delete globalState.__vedaMailSharedStateRedisClient;
    return sharedStateUnavailable();
  }
};

export const probeSharedStateRedis = async (): Promise<void> => {
  if (!sharedStateRedisConfigured()) return;
  const result = await runSharedStateRedis((client) => client.ping());
  if (result !== "PONG") sharedStateUnavailable();
};

export const resetSharedStateRedisClientForTests = (): void => {
  globalState.__vedaMailSharedStateRedisClient?.destroy();
  delete globalState.__vedaMailSharedStateRedisClient;
  delete globalState.__vedaMailSharedStateRedisPromise;
};
