import "server-only";

import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  DEFAULT_DATA_RETENTION_POLICY,
  type DataRetentionPolicy,
} from "@/domain/installation/data-retention-policy";
import {
  dataRetentionPolicyRecordSchema,
  dataRetentionPolicySchema,
} from "@/server/organization/data-retention-policy.schema";
import {
  decryptSharedRecord,
  encryptSharedRecord,
} from "@/server/shared-state/shared-record-crypto";
import { sharedRecordRepository } from
  "@/server/shared-state/shared-record-repository";

const FILE = "data-retention-policy.json";
const SHARED_KIND = "data-retention-policy" as const;
const SHARED_RETRY_LIMIT = 10;
const globalState = globalThis as typeof globalThis & {
  __vedaMailDataRetentionPolicyQueue?: Promise<void>;
};
globalState.__vedaMailDataRetentionPolicyQueue ??= Promise.resolve();
const directory = () => process.env["VEDA_MAIL_DATA_DIR"] ??
  path.join(/* turbopackIgnore: true */ process.cwd(), "data");
const filePath = () => path.join(/* turbopackIgnore: true */ directory(), FILE);
const archivePath = () => `${filePath()}.migrated-to-redis`;
let migrationPromise: Promise<boolean> | undefined;
const serialized = async <T>(task: () => Promise<T>): Promise<T> => {
  const result = globalState.__vedaMailDataRetentionPolicyQueue!.then(task, task);
  globalState.__vedaMailDataRetentionPolicyQueue = result.then(() => undefined, () => undefined);
  return result;
};
const readRecord = async () => {
  try {
    return dataRetentionPolicyRecordSchema.parse(
      JSON.parse(await readFile(filePath(), "utf8")),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
};
const localRead = async (): Promise<DataRetentionPolicy> =>
  (await readRecord())?.policy ?? { ...DEFAULT_DATA_RETENTION_POLICY };
const archive = async (): Promise<void> => {
  try { await rename(filePath(), archivePath()); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
};
const ensureMigrated = async (): Promise<boolean> => {
  if (!sharedRecordRepository.configured()) return false;
  migrationPromise ??= sharedRecordRepository.ensureMigrated(
    SHARED_KIND,
    async () => {
      const record = await readRecord();
      return record ? encryptSharedRecord(SHARED_KIND, record) : null;
    },
    archive,
  );
  return migrationPromise;
};
const sharedRead = async () => {
  const serialized = await sharedRecordRepository.get(SHARED_KIND);
  return {
    policy: serialized
      ? decryptSharedRecord(SHARED_KIND, serialized, dataRetentionPolicyRecordSchema).policy
      : { ...DEFAULT_DATA_RETENTION_POLICY },
    serialized,
  };
};

export const dataRetentionPolicyStore = {
  async get(): Promise<DataRetentionPolicy> {
    return await ensureMigrated() ? (await sharedRead()).policy : localRead();
  },
  put(policy: DataRetentionPolicy): Promise<DataRetentionPolicy> {
    const parsed = dataRetentionPolicySchema.parse(policy);
    return serialized(async () => {
      if (await ensureMigrated()) {
        for (let attempt = 0; attempt < SHARED_RETRY_LIMIT; attempt += 1) {
          const current = await sharedRead();
          const record = {
            policy: parsed, updatedAt: new Date().toISOString(), version: 1 as const,
          };
          if (await sharedRecordRepository.compareAndSet(
            SHARED_KIND, current.serialized,
            encryptSharedRecord(SHARED_KIND, record),
          )) return parsed;
        }
        throw new Error("The shared data retention policy changed too frequently.");
      }
      const targetDirectory = directory();
      const temporary = path.join(targetDirectory, `.${FILE}.${crypto.randomUUID()}`);
      await mkdir(targetDirectory, { mode: 0o700, recursive: true });
      await writeFile(temporary, `${JSON.stringify({
        policy: parsed, updatedAt: new Date().toISOString(), version: 1,
      }, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
      try { await rename(temporary, filePath()); }
      catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
      return parsed;
    });
  },
};
