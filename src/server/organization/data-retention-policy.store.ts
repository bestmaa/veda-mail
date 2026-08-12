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

const FILE = "data-retention-policy.json";
const globalState = globalThis as typeof globalThis & {
  __vedaMailDataRetentionPolicyQueue?: Promise<void>;
};
globalState.__vedaMailDataRetentionPolicyQueue ??= Promise.resolve();
const directory = () => process.env["VEDA_MAIL_DATA_DIR"] ??
  path.join(/* turbopackIgnore: true */ process.cwd(), "data");
const filePath = () => path.join(/* turbopackIgnore: true */ directory(), FILE);
const serialized = async <T>(task: () => Promise<T>): Promise<T> => {
  const result = globalState.__vedaMailDataRetentionPolicyQueue!.then(task, task);
  globalState.__vedaMailDataRetentionPolicyQueue = result.then(() => undefined, () => undefined);
  return result;
};
const read = async (): Promise<DataRetentionPolicy> => {
  try {
    return dataRetentionPolicyRecordSchema.parse(
      JSON.parse(await readFile(filePath(), "utf8")),
    ).policy;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ...DEFAULT_DATA_RETENTION_POLICY };
    }
    throw error;
  }
};

export const dataRetentionPolicyStore = {
  get: read,
  put(policy: DataRetentionPolicy): Promise<DataRetentionPolicy> {
    const parsed = dataRetentionPolicySchema.parse(policy);
    return serialized(async () => {
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
