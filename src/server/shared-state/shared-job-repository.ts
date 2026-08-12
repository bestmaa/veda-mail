import "server-only";

import { randomBytes } from "node:crypto";

import {
  runSharedStateRedis,
  sharedStateRedisConfigured,
  sharedStateRedisPrefix,
} from "@/server/shared-state/shared-state-redis";
import { ApiError } from "@/transport/http/api-error";

export type SharedJobKind =
  | "delivery-notice"
  | "scheduled-send"
  | "send-idempotency"
  | "snooze";

const LOCK_TTL_MS = 60_000;
const LOCK_WAIT_MS = 5_000;
const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;
const RENEW_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`;

const unavailable = (): never => {
  throw new ApiError(
    "Shared background-job storage is temporarily unavailable.",
    "JOB_BACKEND_UNAVAILABLE",
    503,
  );
};

const migrationConflict = (): never => {
  throw new ApiError(
    "Local background jobs remain after the shared repository was initialized.",
    "JOB_BACKEND_MIGRATION_CONFLICT",
    503,
  );
};

const translateFailure = <T>(task: () => Promise<T>): Promise<T> =>
  task().catch((error) => {
    if (error instanceof ApiError && error.code === "SESSION_BACKEND_UNAVAILABLE") {
      return unavailable();
    }
    throw error;
  });

const baseKey = (kind: SharedJobKind): string =>
  `${sharedStateRedisPrefix()}:job:${kind}`;
const ownersKey = (kind: SharedJobKind): string => `${baseKey(kind)}:owners`;
const ownerKey = (kind: SharedJobKind, owner: string): string =>
  `${baseKey(kind)}:owner:${owner}`;
const migrationKey = (kind: SharedJobKind): string => `${baseKey(kind)}:migrated`;
const lockKey = (kind: SharedJobKind): string => `${baseKey(kind)}:lock`;
const migrationLockKey = (kind: SharedJobKind): string =>
  `${baseKey(kind)}:migration-lock`;

const pause = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const withRedisLock = async <T>(key: string, task: () => Promise<T>): Promise<T> => {
  const token = randomBytes(32).toString("base64url");
  const deadline = Date.now() + LOCK_WAIT_MS;
  let acquired = false;
  while (!acquired && Date.now() < deadline) {
    const result = await runSharedStateRedis((client) => client.set(
      key, token, { NX: true, PX: LOCK_TTL_MS },
    ));
    acquired = result === "OK";
    if (!acquired) await pause(20 + Math.floor(Math.random() * 30));
  }
  if (!acquired) unavailable();
  const renewal = setInterval(() => {
    void runSharedStateRedis((client) => client.eval(RENEW_LOCK_SCRIPT, {
      arguments: [token, String(LOCK_TTL_MS)], keys: [key],
    })).catch(() => undefined);
  }, LOCK_TTL_MS / 3);
  renewal.unref();
  try {
    return await task();
  } finally {
    clearInterval(renewal);
    await runSharedStateRedis((client) => client.eval(RELEASE_LOCK_SCRIPT, {
      arguments: [token], keys: [key],
    })).catch(() => undefined);
  }
};

export const sharedJobRepository = {
  configured: sharedStateRedisConfigured,

  async ensureMigrated(
    kind: SharedJobKind,
    localRecords: () => Promise<Readonly<Record<string, string>>>,
  ): Promise<boolean> {
    if (!sharedStateRedisConfigured()) return false;
    return translateFailure(async () => {
      const records = await localRecords();
      const migrated = await runSharedStateRedis((client) => client.exists(migrationKey(kind)));
      if (Number(migrated) === 1) {
        if (Object.keys(records).length > 0) migrationConflict();
        return true;
      }
      await withRedisLock(migrationLockKey(kind), async () => {
        const alreadyMigrated = await runSharedStateRedis((client) =>
          client.exists(migrationKey(kind)));
        if (Number(alreadyMigrated) === 1) {
          if (Object.keys(records).length > 0) migrationConflict();
          return;
        }
        await runSharedStateRedis(async (client) => {
          const transaction = client.multi();
          for (const [owner, serialized] of Object.entries(records)) {
            transaction.set(ownerKey(kind, owner), serialized);
            transaction.sAdd(ownersKey(kind), owner);
          }
          transaction.set(migrationKey(kind), new Date().toISOString());
          await transaction.exec();
        });
      });
      return true;
    });
  },

  async get(kind: SharedJobKind, owner: string): Promise<string | null> {
    return translateFailure(async () =>
      (await runSharedStateRedis((client) => client.get(ownerKey(kind, owner)))) ?? null);
  },

  async count(kind: SharedJobKind): Promise<number> {
    return translateFailure(async () => Number(
      (await runSharedStateRedis((client) => client.sCard(ownersKey(kind)))) ?? 0,
    ));
  },

  async list(kind: SharedJobKind): Promise<ReadonlyMap<string, string>> {
    return translateFailure(async () => {
      const records = await runSharedStateRedis(async (client) => {
        const owners = await client.sMembers(ownersKey(kind));
        if (owners.length === 0) return new Map<string, string>();
        const values = await client.mGet(owners.map((owner) => ownerKey(kind, owner)));
        const result = new Map<string, string>();
        const stale: string[] = [];
        values.forEach((value, index) => {
          const owner = owners[index]!;
          if (value === null) stale.push(owner);
          else result.set(owner, value);
        });
        if (stale.length > 0) await client.sRem(ownersKey(kind), stale);
        return result;
      });
      return records ?? new Map<string, string>();
    });
  },

  async replace(
    kind: SharedJobKind,
    owner: string,
    serialized: string | null,
    expiresAt?: number,
  ): Promise<void> {
    await translateFailure(async () => {
      await runSharedStateRedis(async (client) => {
        const transaction = client.multi();
        if (serialized === null) {
          transaction.del(ownerKey(kind, owner));
          transaction.sRem(ownersKey(kind), owner);
        } else {
          const ttl = expiresAt === undefined ? undefined : Math.ceil(expiresAt - Date.now());
          if (ttl !== undefined && ttl <= 0) unavailable();
          if (ttl === undefined) transaction.set(ownerKey(kind, owner), serialized);
          else transaction.set(ownerKey(kind, owner), serialized, { PX: ttl });
          transaction.sAdd(ownersKey(kind), owner);
        }
        await transaction.exec();
      });
    });
  },

  async replaceMany(
    kind: SharedJobKind,
    records: readonly {
      readonly expiresAt?: number;
      readonly owner: string;
      readonly serialized: string | null;
    }[],
  ): Promise<void> {
    if (records.length === 0) return;
    await translateFailure(async () => {
      await runSharedStateRedis(async (client) => {
        const transaction = client.multi();
        for (const { expiresAt, owner, serialized } of records) {
          if (serialized === null) {
            transaction.del(ownerKey(kind, owner));
            transaction.sRem(ownersKey(kind), owner);
            continue;
          }
          const ttl = expiresAt === undefined
            ? undefined
            : Math.ceil(expiresAt - Date.now());
          if (ttl !== undefined && ttl <= 0) unavailable();
          if (ttl === undefined) transaction.set(ownerKey(kind, owner), serialized);
          else transaction.set(ownerKey(kind, owner), serialized, { PX: ttl });
          transaction.sAdd(ownersKey(kind), owner);
        }
        await transaction.exec();
      });
    });
  },

  async withLock<T>(kind: SharedJobKind, task: () => Promise<T>): Promise<T> {
    if (!sharedStateRedisConfigured()) return task();
    return translateFailure(() => withRedisLock(lockKey(kind), task));
  },
};
