import "server-only";

import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  DEFAULT_MAIL_CONTENT_POLICY,
  type MailContentPolicy,
} from "@/domain/installation/mail-content-policy";
import {
  mailContentPolicyRecordSchema,
  mailContentPolicySchema,
} from "@/server/organization/mail-content-policy.schema";
import {
  decryptSharedRecord,
  encryptSharedRecord,
} from "@/server/shared-state/shared-record-crypto";
import { sharedRecordRepository } from
  "@/server/shared-state/shared-record-repository";

const DATA_FILE = "mail-content-policy.json";
const SHARED_KIND = "mail-content-policy" as const;
const SHARED_RETRY_LIMIT = 10;
interface StoreState { writeQueue: Promise<void> }
const globalState = globalThis as typeof globalThis & {
  __vedaMailContentPolicyStore?: StoreState;
};
const state = globalState.__vedaMailContentPolicyStore ?? {
  writeQueue: Promise.resolve(),
};
globalState.__vedaMailContentPolicyStore = state;

const dataDirectory = (): string =>
  process.env["VEDA_MAIL_DATA_DIR"] ??
  path.join(/*turbopackIgnore: true*/ process.cwd(), "data");
const policyPath = (): string => path.join(dataDirectory(), DATA_FILE);
const archivePath = (): string => `${policyPath()}.migrated-to-redis`;
let migrationPromise: Promise<boolean> | undefined;

const readRecord = async () => {
  try {
    return mailContentPolicyRecordSchema.parse(
      JSON.parse(await readFile(policyPath(), "utf8")),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
};
const localRead = async (): Promise<MailContentPolicy> =>
  (await readRecord())?.policy ?? { ...DEFAULT_MAIL_CONTENT_POLICY };
const archive = async (): Promise<void> => {
  try { await rename(policyPath(), archivePath()); }
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
      ? decryptSharedRecord(SHARED_KIND, serialized, mailContentPolicyRecordSchema).policy
      : { ...DEFAULT_MAIL_CONTENT_POLICY },
    serialized,
  };
};

const serializeWrite = async <T>(task: () => Promise<T>): Promise<T> => {
  const result = state.writeQueue.then(task, task);
  state.writeQueue = result.then(() => undefined, () => undefined);
  return result;
};

export const mailContentPolicyStore = {
  async get(): Promise<MailContentPolicy> {
    return await ensureMigrated() ? (await sharedRead()).policy : localRead();
  },
  put(policy: MailContentPolicy): Promise<MailContentPolicy> {
    const parsed = mailContentPolicySchema.parse(policy);
    return serializeWrite(async () => {
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
        throw new Error("The shared mail content policy changed too frequently.");
      }
      const directory = dataDirectory();
      const temporary = path.join(directory, `.${DATA_FILE}.${crypto.randomUUID()}`);
      await mkdir(directory, { mode: 0o700, recursive: true });
      await writeFile(temporary, `${JSON.stringify({
        policy: parsed,
        updatedAt: new Date().toISOString(),
        version: 1,
      }, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
      try {
        await rename(temporary, policyPath());
      } catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
      }
      return parsed;
    });
  },
};
