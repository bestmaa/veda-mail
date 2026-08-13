import "server-only";

import { randomBytes } from "node:crypto";

import {
  runSharedStateRedis,
  sharedStateRedisConfigured,
  sharedStateRedisPrefix,
} from "@/server/shared-state/shared-state-redis";
import { ApiError } from "@/transport/http/api-error";

export type SharedRecordKind =
  | "data-retention-policy"
  | "mail-content-policy"
  | "organization-policy"
  | "security-audit";

const LOCK_TTL_MS = 60_000;
const LOCK_WAIT_MS = 5_000;
const MAX_RECORD_BYTES: Readonly<Record<SharedRecordKind, number>> = {
  "data-retention-policy": 8 * 1_024,
  "mail-content-policy": 48 * 1_024,
  "organization-policy": 8 * 1_024,
  "security-audit": 24 * 1_024 * 1_024,
};
const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;
const RENEW_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`;
const COMPARE_AND_SET_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if ARGV[1] == 'missing' then
  if current then return 0 end
elseif current ~= ARGV[2] then
  return 0
end
redis.call('SET', KEYS[1], ARGV[3])
return 1
`;

const unavailable = (): never => {
  throw new ApiError(
    "Shared application state is temporarily unavailable.",
    "SHARED_RECORD_BACKEND_UNAVAILABLE",
    503,
  );
};
const conflict = (): never => {
  throw new ApiError(
    "Local application state remains after shared storage was initialized.",
    "SHARED_RECORD_MIGRATION_CONFLICT",
    503,
  );
};
const prefix = (kind: SharedRecordKind) =>
  `${sharedStateRedisPrefix()}:singleton-record:${kind}`;
const recordKey = (kind: SharedRecordKind) => `${prefix(kind)}:value`;
const migrationKey = (kind: SharedRecordKind) => `${prefix(kind)}:migrated`;
const lockKey = (kind: SharedRecordKind) => `${prefix(kind)}:lock`;
const assertRecord = (kind: SharedRecordKind, value: string): void => {
  if (Buffer.byteLength(value, "utf8") > MAX_RECORD_BYTES[kind]) unavailable();
};
const run = async <T>(task: Parameters<typeof runSharedStateRedis<T>>[0]) => {
  try {
    if (!sharedStateRedisConfigured()) unavailable();
    return await runSharedStateRedis(task) as T;
  } catch (error) {
    if (error instanceof ApiError &&
        error.code === "SESSION_BACKEND_UNAVAILABLE") unavailable();
    throw error;
  }
};
const pause = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const withLock = async <T>(kind: SharedRecordKind, task: () => Promise<T>) => {
  const token = randomBytes(32).toString("base64url");
  const deadline = Date.now() + LOCK_WAIT_MS;
  let acquired = false;
  while (!acquired && Date.now() < deadline) {
    acquired = await run((client) => client.set(
      lockKey(kind), token, { NX: true, PX: LOCK_TTL_MS },
    )) === "OK";
    if (!acquired) await pause(20 + Math.floor(Math.random() * 30));
  }
  if (!acquired) unavailable();
  const renewal = setInterval(() => {
    void run((client) => client.eval(RENEW_SCRIPT, {
      arguments: [token, String(LOCK_TTL_MS)], keys: [lockKey(kind)],
    })).catch(() => undefined);
  }, LOCK_TTL_MS / 3);
  renewal.unref();
  try { return await task(); }
  finally {
    clearInterval(renewal);
    await run((client) => client.eval(RELEASE_SCRIPT, {
      arguments: [token], keys: [lockKey(kind)],
    })).catch(() => undefined);
  }
};

export const sharedRecordRepository = {
  configured: sharedStateRedisConfigured,

  async ensureMigrated(
    kind: SharedRecordKind,
    local: () => Promise<string | null>,
    archive: () => Promise<void>,
  ): Promise<boolean> {
    if (!sharedStateRedisConfigured()) return false;
    return withLock(kind, async () => {
      const value = await local();
      if (Number(await run((client) =>
        client.exists(migrationKey(kind)))) === 1) {
        if (value !== null) conflict();
        return true;
      }
      if (value !== null) assertRecord(kind, value);
      await run(async (client) => {
        const transaction = client.multi();
        if (value !== null) transaction.set(recordKey(kind), value);
        transaction.set(migrationKey(kind), new Date().toISOString());
        await transaction.exec();
      });
      await archive();
      return true;
    });
  },

  async get(kind: SharedRecordKind): Promise<string | null> {
    return (await run((client) => client.get(recordKey(kind)))) ?? null;
  },

  async compareAndSet(
    kind: SharedRecordKind,
    expected: string | null,
    value: string,
  ): Promise<boolean> {
    if (expected !== null) assertRecord(kind, expected);
    assertRecord(kind, value);
    return Number(await run((client) => client.eval(
      COMPARE_AND_SET_SCRIPT,
      {
        arguments: [
          expected === null ? "missing" : "present",
          expected ?? "",
          value,
        ],
        keys: [recordKey(kind)],
      },
    ))) === 1;
  },
};
