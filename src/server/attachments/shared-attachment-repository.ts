import "server-only";

import type { StoredAttachment } from
  "@/server/attachments/attachment-record";
import {
  decryptSharedAttachmentRecord,
  encryptSharedAttachmentRecord,
} from "@/server/attachments/shared-attachment-crypto";
import { sharedJobRepository } from
  "@/server/shared-state/shared-job-repository";
import {
  runSharedStateRedis,
  sharedStateRedisConfigured,
  sharedStateRedisPrefix,
  type SharedStateRedisClient,
} from "@/server/shared-state/shared-state-redis";
import { ApiError } from "@/transport/http/api-error";

const CHUNK_BYTES = 768 * 1_024;
const MAX_CHUNKS = 32;
const MAX_RECORDS = 1_000;

const unavailable = (): never => {
  throw new ApiError(
    "Shared attachment quarantine is temporarily unavailable.",
    "ATTACHMENT_STORAGE_UNAVAILABLE",
    503,
  );
};

const prefix = (): string => `${sharedStateRedisPrefix()}:attachment:v1`;
const recordsKey = (): string => `${prefix()}:records`;
const recordKey = (id: string): string => `${prefix()}:record:${id}`;
const manifestKey = (id: string): string => `${prefix()}:blob:${id}:manifest`;
const chunkKey = (id: string, index: number): string =>
  `${prefix()}:blob:${id}:chunk:${index}`;

const ttl = (expiresAt: number): number => {
  const value = Math.ceil(expiresAt - Date.now());
  if (!Number.isSafeInteger(value) || value <= 0) unavailable();
  return value;
};

const run = async <T>(
  task: (client: SharedStateRedisClient) => Promise<T>,
): Promise<T> => {
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

export const sharedAttachmentRepository = (rootKey: Buffer) => ({
  configured: sharedStateRedisConfigured,

  async withLock<T>(task: () => Promise<T>): Promise<T> {
    try {
      return await sharedJobRepository.withLock("attachment-quarantine", task);
    } catch (error) {
      if (error instanceof ApiError && [
        "JOB_BACKEND_UNAVAILABLE", "SESSION_BACKEND_UNAVAILABLE",
      ].includes(error.code)) unavailable();
      throw error;
    }
  },

  async get(id: string): Promise<StoredAttachment | undefined> {
    const value = await run((client) => client.get(recordKey(id)));
    if (value === null) return undefined;
    return decryptSharedAttachmentRecord(rootKey, id, value);
  },

  async list(): Promise<readonly StoredAttachment[]> {
    const ids = await run((client) => client.zRange(recordsKey(), 0, MAX_RECORDS));
    if (ids.length > MAX_RECORDS) unavailable();
    if (ids.length === 0) return [];
    const values = await run((client) =>
      client.mGet(ids.map((id) => recordKey(id))));
    const stale: string[] = [];
    const records: StoredAttachment[] = [];
    values.forEach((value, index) => {
      const id = ids[index]!;
      if (value === null) stale.push(id);
      else records.push(decryptSharedAttachmentRecord(rootKey, id, value));
    });
    if (stale.length > 0) await run((client) => client.zRem(recordsKey(), stale));
    return records;
  },

  async put(record: StoredAttachment): Promise<void> {
    const duration = ttl(record.expiresAt);
    const serialized = encryptSharedAttachmentRecord(rootKey, record);
    await run(async (client) => {
      await client.multi()
        .set(recordKey(record.id), serialized, { PX: duration })
        .zAdd(recordsKey(), { score: record.expiresAt, value: record.id })
        .exec();
    });
  },

  async putMany(records: readonly StoredAttachment[]): Promise<void> {
    if (records.length === 0) return;
    const values = records.map((record) => ({
      duration: ttl(record.expiresAt),
      record,
      serialized: encryptSharedAttachmentRecord(rootKey, record),
    }));
    await run(async (client) => {
      const transaction = client.multi();
      for (const { duration, record, serialized } of values) {
        transaction.set(recordKey(record.id), serialized, { PX: duration });
        transaction.zAdd(
          recordsKey(), { score: record.expiresAt, value: record.id },
        );
      }
      await transaction.exec();
    });
  },

  async putBlob(id: string, contents: Buffer, expiresAt: number): Promise<void> {
    const chunks: string[] = [];
    for (let offset = 0; offset < contents.byteLength; offset += CHUNK_BYTES) {
      chunks.push(contents.subarray(offset, offset + CHUNK_BYTES).toString("base64"));
    }
    if (chunks.length < 1 || chunks.length > MAX_CHUNKS) unavailable();
    const duration = ttl(expiresAt);
    await run(async (client) => {
      const transaction = client.multi();
      chunks.forEach((chunk, index) =>
        transaction.set(chunkKey(id, index), chunk, { PX: duration }));
      transaction.set(manifestKey(id), String(chunks.length), { PX: duration });
      await transaction.exec();
    });
  },

  async getBlob(id: string): Promise<Buffer> {
    const manifest = await run((client) => client.get(manifestKey(id)));
    const count = Number(manifest);
    if (!Number.isSafeInteger(count) || count < 1 || count > MAX_CHUNKS) {
      throw new Error("Shared attachment blob manifest is invalid.");
    }
    const chunks = await run((client) => client.mGet(
      Array.from({ length: count }, (_, index) => chunkKey(id, index)),
    ));
    if (chunks.some((chunk) => chunk === null)) {
      throw new Error("Shared attachment blob is incomplete.");
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk!, "base64")));
  },

  async removeBlob(id: string): Promise<void> {
    const manifest = await run((client) => client.get(manifestKey(id)));
    const count = Number(manifest);
    await run(async (client) => {
      const transaction = client.multi().del(manifestKey(id));
      if (Number.isSafeInteger(count) && count > 0 && count <= MAX_CHUNKS) {
        for (let index = 0; index < count; index += 1) {
          transaction.del(chunkKey(id, index));
        }
      }
      await transaction.exec();
    });
  },

  async remove(id: string): Promise<void> {
    const manifest = await run((client) => client.get(manifestKey(id)));
    const count = Number(manifest);
    await run(async (client) => {
      const transaction = client.multi()
        .del(recordKey(id)).zRem(recordsKey(), id).del(manifestKey(id));
      if (Number.isSafeInteger(count) && count > 0 && count <= MAX_CHUNKS) {
        for (let index = 0; index < count; index += 1) {
          transaction.del(chunkKey(id, index));
        }
      }
      await transaction.exec();
    });
  },

  async removeMany(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const manifests = await run((client) =>
      client.mGet(ids.map(manifestKey)));
    await run(async (client) => {
      const transaction = client.multi();
      ids.forEach((id, position) => {
        transaction.del(recordKey(id)).zRem(recordsKey(), id)
          .del(manifestKey(id));
        const count = Number(manifests[position]);
        if (Number.isSafeInteger(count) && count > 0 && count <= MAX_CHUNKS) {
          for (let index = 0; index < count; index += 1) {
            transaction.del(chunkKey(id, index));
          }
        }
      });
      await transaction.exec();
    });
  },
});

export type SharedAttachmentRepository = ReturnType<
  typeof sharedAttachmentRepository
>;
