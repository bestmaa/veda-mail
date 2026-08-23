import "server-only";

import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  mailForwardingLedgerSchema,
  type MailForwardingLedger,
} from "@/server/mail-forwarding/mail-forwarding.schema";
import {
  decryptSharedRecord,
  encryptSharedRecord,
} from "@/server/shared-state/shared-record-crypto";
import { sharedRecordRepository } from "@/server/shared-state/shared-record-repository";

const KIND = "mail-forwarding" as const;
const DATA_FILE = "mail-forwarding.enc.json";
const EMPTY: MailForwardingLedger = {
  entries: [], revision: 0, updatedAt: new Date(0).toISOString(), version: 1,
};
const globalState = globalThis as typeof globalThis & {
  __vedaMailForwardingQueue?: Promise<void>;
};
globalState.__vedaMailForwardingQueue ??= Promise.resolve();
let migrationPromise: Promise<boolean> | undefined;

const dataDirectory = () => process.env["VEDA_MAIL_DATA_DIR"] ??
  path.join(/*turbopackIgnore: true*/ process.cwd(), "data");
const filePath = () => path.join(dataDirectory(), DATA_FILE);
const archivePath = () => `${filePath()}.migrated-to-redis`;
const decode = (serialized: string): MailForwardingLedger =>
  decryptSharedRecord(KIND, serialized, mailForwardingLedgerSchema);
const localSerialized = async (): Promise<string | null> => {
  try { return await readFile(filePath(), "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
};
const archive = async () => {
  try { await rename(filePath(), archivePath()); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
};
const shared = async () => {
  const serialized = await sharedRecordRepository.get(KIND);
  return { ledger: serialized ? decode(serialized) : EMPTY, serialized };
};
const ensureMigrated = async () => {
  if (!sharedRecordRepository.configured()) return false;
  migrationPromise ??= sharedRecordRepository.ensureMigrated(
    KIND, localSerialized, archive,
  );
  return migrationPromise;
};
const localWrite = async (ledger: MailForwardingLedger) => {
  const directory = dataDirectory();
  const temporary = path.join(directory, `.${DATA_FILE}.${crypto.randomUUID()}`);
  await mkdir(directory, { mode: 0o700, recursive: true });
  await writeFile(temporary, encryptSharedRecord(KIND, ledger), {
    encoding: "utf8", flag: "wx", mode: 0o600,
  });
  try { await rename(temporary, filePath()); }
  catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
};

export const mailForwardingStore = {
  async get(): Promise<MailForwardingLedger> {
    if (await ensureMigrated()) return (await shared()).ledger;
    const serialized = await localSerialized();
    return serialized ? decode(serialized) : EMPTY;
  },
  async getForSource(sourceEmail: string) {
    const ledger = await this.get();
    for (const entry of ledger.entries) {
      if (entry.sourceEmail.toLowerCase() === sourceEmail.toLowerCase()) return entry;
    }
    return null;
  },
  put(expectedRevision: number, ledger: MailForwardingLedger): Promise<boolean> {
    const parsed = mailForwardingLedgerSchema.parse(ledger);
    const task = async () => {
      if (await ensureMigrated()) {
        const current = await shared();
        if (current.ledger.revision !== expectedRevision) return false;
        return sharedRecordRepository.compareAndSet(
          KIND, current.serialized, encryptSharedRecord(KIND, parsed),
        );
      }
      const currentSerialized = await localSerialized();
      const current = currentSerialized ? decode(currentSerialized) : EMPTY;
      if (current.revision !== expectedRevision) return false;
      await localWrite(parsed);
      return true;
    };
    const result = globalState.__vedaMailForwardingQueue!.then(task, task);
    globalState.__vedaMailForwardingQueue = result.then(() => undefined, () => undefined);
    return result;
  },
};
