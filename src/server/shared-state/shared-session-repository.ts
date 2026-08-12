import "server-only";

import { ApiError } from "@/transport/http/api-error";
import {
  runSharedStateRedis,
  sharedStateRedisPrefix,
} from "@/server/shared-state/shared-state-redis";
import type { SharedSessionKind } from "@/server/shared-state/shared-session-crypto";

const MAX_SESSIONS_PER_KIND = 10_000;

const CREATE_SCRIPT = `
local exists = redis.call('EXISTS', KEYS[1])
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[5])
if KEYS[3] ~= KEYS[2] then redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', ARGV[5]) end
if exists == 0 and redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[3]) then
  return -1
end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
redis.call('ZADD', KEYS[2], ARGV[6], ARGV[4])
if KEYS[3] ~= KEYS[2] then redis.call('ZADD', KEYS[3], ARGV[6], ARGV[4]) end
return 1
`;

const CAS_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
redis.call('ZADD', KEYS[2], ARGV[4], ARGV[5])
if KEYS[3] ~= KEYS[2] then redis.call('ZADD', KEYS[3], ARGV[4], ARGV[5]) end
return 1
`;

const LIST_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
return redis.call('ZRANGEBYSCORE', KEYS[1], ARGV[1], '+inf', 'LIMIT', 0, ARGV[2])
`;

const prefix = (): string => `${sharedStateRedisPrefix()}:session`;
const recordKey = (kind: SharedSessionKind, opaqueId: string): string =>
  `${prefix()}:${kind}:record:${opaqueId}`;
const allIndexKey = (kind: SharedSessionKind): string =>
  `${prefix()}:${kind}:all`;
const ownerIndexKey = (kind: SharedSessionKind, ownerIndex?: string): string =>
  ownerIndex ? `${prefix()}:${kind}:owner:${ownerIndex}` : allIndexKey(kind);

const ttl = (expiresAt: number): number => {
  const value = Math.ceil(expiresAt - Date.now());
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError("Shared session expiry must be in the future.");
  }
  return value;
};

const capacityExceeded = (): never => {
  throw new ApiError(
    "The shared session repository reached its safe capacity.",
    "SESSION_CAPACITY_EXCEEDED",
    503,
  );
};

export interface SharedSessionValue {
  readonly opaqueId: string;
  readonly serialized: string;
}

export const sharedSessionRepository = {
  async create(input: {
    readonly expiresAt: number;
    readonly kind: SharedSessionKind;
    readonly opaqueId: string;
    readonly ownerIndex?: string;
    readonly serialized: string;
  }): Promise<boolean> {
    const result = await runSharedStateRedis((client) => client.eval(CREATE_SCRIPT, {
      arguments: [
        input.serialized,
        String(ttl(input.expiresAt)),
        String(MAX_SESSIONS_PER_KIND),
        input.opaqueId,
        String(Date.now()),
        String(input.expiresAt),
      ],
      keys: [
        recordKey(input.kind, input.opaqueId),
        allIndexKey(input.kind),
        ownerIndexKey(input.kind, input.ownerIndex),
      ],
    }));
    if (result === null) return false;
    if (Number(result) === -1) capacityExceeded();
    return true;
  },

  async get(
    kind: SharedSessionKind,
    opaqueId: string,
  ): Promise<SharedSessionValue | null | undefined> {
    const result = await runSharedStateRedis((client) =>
      client.get(recordKey(kind, opaqueId)));
    if (result === null) {
      return await runSharedStateRedis(async (client) => {
        await client.zRem(allIndexKey(kind), opaqueId);
        return null;
      });
    }
    if (result === undefined) return undefined;
    return { opaqueId, serialized: result };
  },

  async compareAndSet(input: {
    readonly expiresAt: number;
    readonly expected: string;
    readonly kind: SharedSessionKind;
    readonly opaqueId: string;
    readonly ownerIndex?: string;
    readonly serialized: string;
  }): Promise<boolean | null> {
    const result = await runSharedStateRedis((client) => client.eval(CAS_SCRIPT, {
      arguments: [
        input.expected,
        input.serialized,
        String(ttl(input.expiresAt)),
        String(input.expiresAt),
        input.opaqueId,
      ],
      keys: [
        recordKey(input.kind, input.opaqueId),
        allIndexKey(input.kind),
        ownerIndexKey(input.kind, input.ownerIndex),
      ],
    }));
    return result === null ? null : Number(result) === 1;
  },

  async list(
    kind: SharedSessionKind,
    ownerIndex?: string,
  ): Promise<readonly SharedSessionValue[] | null> {
    return runSharedStateRedis(async (client) => {
      const indexKey = ownerIndexKey(kind, ownerIndex);
      const ids = await client.eval(LIST_SCRIPT, {
        arguments: [String(Date.now()), String(MAX_SESSIONS_PER_KIND + 1)],
        keys: [indexKey],
      }) as string[];
      if (ids.length > MAX_SESSIONS_PER_KIND) capacityExceeded();
      if (ids.length === 0) return [];
      const values = await client.mGet(ids.map((opaqueId) => recordKey(kind, opaqueId)));
      const stale: string[] = [];
      const records: SharedSessionValue[] = [];
      values.forEach((serialized, index) => {
        if (serialized === null) stale.push(ids[index]!);
        else records.push({ opaqueId: ids[index]!, serialized });
      });
      if (stale.length > 0) await client.zRem(indexKey, stale);
      return records;
    });
  },

  async remove(input: {
    readonly kind: SharedSessionKind;
    readonly opaqueId: string;
    readonly ownerIndex?: string;
  }): Promise<boolean | null> {
    const result = await runSharedStateRedis(async (client) => {
      const transaction = client.multi()
        .del(recordKey(input.kind, input.opaqueId))
        .zRem(allIndexKey(input.kind), input.opaqueId);
      if (input.ownerIndex) {
        transaction.zRem(ownerIndexKey(input.kind, input.ownerIndex), input.opaqueId);
      }
      const values = await transaction.exec();
      return Number(values[0]) === 1;
    });
    return result;
  },

  async clear(kind: SharedSessionKind): Promise<boolean> {
    const result = await runSharedStateRedis(async (client) => {
      const ids = await client.zRange(allIndexKey(kind), 0, MAX_SESSIONS_PER_KIND - 1);
      const transaction = client.multi().del(allIndexKey(kind));
      for (const opaqueId of ids.slice(0, MAX_SESSIONS_PER_KIND)) {
        transaction.del(recordKey(kind, opaqueId));
      }
      await transaction.exec();
      return true;
    });
    return result ?? false;
  },
};
