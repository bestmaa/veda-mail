import "server-only";

import { mkdir, open, rename, unlink } from "node:fs/promises";
import path from "node:path";

import { assertSnoozeKeyCheck, snoozeKeyCheck } from "@/server/snooze/snooze-key";
import {
  type SnoozeJobFile,
  snoozeJobFileSchema,
} from "@/server/snooze/snooze-record";

const FILE_NAME = "snooze-jobs.json";
export const MAX_SNOOZE_FILE_BYTES = 64 * 1024 * 1024;
const dataDirectory = () => process.env["VEDA_MAIL_DATA_DIR"] ??
  path.join(/* turbopackIgnore: true */ process.cwd(), "data");
export const snoozeFilePath = () =>
  path.join(/* turbopackIgnore: true */ dataDirectory(), FILE_NAME);
const emptyFile = (): SnoozeJobFile => ({
  keyCheck: snoozeKeyCheck(), owners: {}, updatedAt: new Date(0).toISOString(), version: 1,
});

export const readSnoozeFile = async (): Promise<SnoozeJobFile> => {
  let handle;
  try {
    handle = await open(/* turbopackIgnore: true */ snoozeFilePath(), "r");
    const stats = await handle.stat();
    if (stats.size > MAX_SNOOZE_FILE_BYTES) throw new Error("Snooze store is too large.");
    const bytes = await handle.readFile();
    if (bytes.length > MAX_SNOOZE_FILE_BYTES) throw new Error("Snooze store is too large.");
    const parsed = snoozeJobFileSchema.parse(JSON.parse(bytes.toString("utf8")));
    assertSnoozeKeyCheck(parsed.keyCheck);
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyFile();
    throw error;
  } finally { await handle?.close(); }
};

export const writeSnoozeFile = async (value: SnoozeJobFile): Promise<void> => {
  const parsed = snoozeJobFileSchema.parse(value);
  assertSnoozeKeyCheck(parsed.keyCheck);
  const contents = `${JSON.stringify(parsed, null, 2)}\n`;
  if (Buffer.byteLength(contents) > MAX_SNOOZE_FILE_BYTES) {
    throw new Error("Snooze store is too large.");
  }
  const directory = dataDirectory();
  const temporary = path.join(directory, `.${FILE_NAME}.${crypto.randomUUID()}`);
  await mkdir(/* turbopackIgnore: true */ directory, { mode: 0o700, recursive: true });
  let handle;
  try {
    handle = await open(/* turbopackIgnore: true */ temporary, "wx", 0o600);
    await handle.writeFile(contents); await handle.sync(); await handle.close();
    handle = undefined;
    await rename(/* turbopackIgnore: true */ temporary,
      /* turbopackIgnore: true */ snoozeFilePath());
    const parent = await open(/* turbopackIgnore: true */ directory, "r").catch(() => null);
    await parent?.sync().catch(() => undefined); await parent?.close().catch(() => undefined);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(/* turbopackIgnore: true */ temporary).catch(() => undefined);
    throw error;
  }
};
