import "server-only";

import { randomBytes } from "node:crypto";

import {
  runSharedStateRedis,
  sharedStateRedisConfigured,
  sharedStateRedisPrefix,
} from "@/server/shared-state/shared-state-redis";
import { ApiError } from "@/transport/http/api-error";

export type SharedOwnerKind = "message-list-preferences";

const LOCK_TTL_MS = 60_000;
const LOCK_WAIT_MS = 5_000;
const MAX_OWNERS = 10_000;
const MAX_RECORD_BYTES = 512 * 1_024;
const OWNER_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
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

const unavailable = (): never => {
  throw new ApiError(
    "Shared member settings are temporarily unavailable.",
    "SHARED_OWNER_BACKEND_UNAVAILABLE",
    503,
  );
};
const conflict = (): never => {
  throw new ApiError(
    "Local member settings remain after shared storage was initialized.",
    "SHARED_OWNER_MIGRATION_CONFLICT",
    503,
  );
};
const prefix = (kind: SharedOwnerKind) =>
  `${sharedStateRedisPrefix()}:owner-record:${kind}`;
const ownersKey = (kind: SharedOwnerKind) => `${prefix(kind)}:owners`;
const recordKey = (kind: SharedOwnerKind, owner: string) =>
  `${prefix(kind)}:record:${owner}`;
const migrationKey = (kind: SharedOwnerKind) => `${prefix(kind)}:migrated`;
const lockKey = (kind: SharedOwnerKind) => `${prefix(kind)}:lock`;

const assertRecord = (owner: string, value: string): void => {
  if (!OWNER_PATTERN.test(owner) ||
    Buffer.byteLength(value, "utf8") > MAX_RECORD_BYTES) unavailable();
};

const run = async <T>(task: Parameters<typeof runSharedStateRedis<T>>[0]) => {
  try {
    if (!sharedStateRedisConfigured()) unavailable();
    const result = await runSharedStateRedis(task);
    return result as T;
  } catch (error) {
    if (error instanceof ApiError &&
      error.code === "SESSION_BACKEND_UNAVAILABLE") unavailable();
    throw error;
  }
};
const pause = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const withLock = async <T>(kind: SharedOwnerKind, task: () => Promise<T>) => {
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
  try {
    return await task();
  } finally {
    clearInterval(renewal);
    await run((client) => client.eval(RELEASE_SCRIPT, {
      arguments: [token], keys: [lockKey(kind)],
    })).catch(() => undefined);
  }
};

export const sharedOwnerRepository = {
  configured: sharedStateRedisConfigured,

  async ensureMigrated(
    kind: SharedOwnerKind,
    local: () => Promise<Readonly<Record<string, string>>>,
    archive: () => Promise<void>,
  ): Promise<boolean> {
    if (!sharedStateRedisConfigured()) return false;
    return withLock(kind, async () => {
      const records = await local();
      if (Number(await run((client) => client.exists(migrationKey(kind)))) === 1) {
        if (Object.keys(records).length > 0) conflict();
        return true;
      }
      if (Object.keys(records).length > MAX_OWNERS) unavailable();
      Object.entries(records).forEach(([owner, value]) =>
        assertRecord(owner, value));
      await run(async (client) => {
        const transaction = client.multi();
        for (const [owner, value] of Object.entries(records)) {
          transaction.set(recordKey(kind, owner), value);
          transaction.sAdd(ownersKey(kind), owner);
        }
        transaction.set(migrationKey(kind), new Date().toISOString());
        await transaction.exec();
      });
      await archive();
      return true;
    });
  },

  async get(kind: SharedOwnerKind, owner: string): Promise<string | null> {
    if (!OWNER_PATTERN.test(owner)) unavailable();
    return (await run((client) => client.get(recordKey(kind, owner)))) ?? null;
  },

  async replace(
    kind: SharedOwnerKind,
    owner: string,
    value: string,
  ): Promise<void> {
    assertRecord(owner, value);
    await withLock(kind, async () => {
      const exists = Number(await run((client) =>
        client.sIsMember(ownersKey(kind), owner)));
      if (exists === 0 && Number(await run((client) =>
        client.sCard(ownersKey(kind)))) >= MAX_OWNERS) unavailable();
      await run(async (client) => {
        await client.multi().set(recordKey(kind, owner), value)
          .sAdd(ownersKey(kind), owner).exec();
      });
    });
  },
};
