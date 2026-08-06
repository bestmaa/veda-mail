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

const DATA_FILE = "mail-content-policy.json";
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

const read = async (): Promise<MailContentPolicy> => {
  try {
    return mailContentPolicyRecordSchema.parse(
      JSON.parse(await readFile(policyPath(), "utf8")),
    ).policy;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ...DEFAULT_MAIL_CONTENT_POLICY };
    }
    throw error;
  }
};

const serializeWrite = async <T>(task: () => Promise<T>): Promise<T> => {
  const result = state.writeQueue.then(task, task);
  state.writeQueue = result.then(() => undefined, () => undefined);
  return result;
};

export const mailContentPolicyStore = {
  get: read,
  put(policy: MailContentPolicy): Promise<MailContentPolicy> {
    const parsed = mailContentPolicySchema.parse(policy);
    return serializeWrite(async () => {
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
