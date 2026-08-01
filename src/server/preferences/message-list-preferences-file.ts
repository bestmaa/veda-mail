import "server-only";

import { mkdir, open, rename, unlink } from "node:fs/promises";
import path from "node:path";

import {
  type MessageListPreferencesFile,
  messageListPreferencesFileSchema,
} from "@/server/preferences/message-list-preferences-record";

const FILE_NAME = "message-list-preferences.json";
const MAX_FILE_BYTES = 16 * 1_024 * 1_024;

const dataDirectory = (): string =>
  process.env["VEDA_MAIL_DATA_DIR"] ??
  path.join(/* turbopackIgnore: true */ process.cwd(), "data");

export const messageListPreferencesFilePath = (): string =>
  path.join(/* turbopackIgnore: true */ dataDirectory(), FILE_NAME);

const emptyFile = (): MessageListPreferencesFile => ({
  owners: {},
  updatedAt: new Date(0).toISOString(),
  version: 1,
});

export const readMessageListPreferencesFile = async () => {
  let handle;
  try {
    handle = await open(
      /* turbopackIgnore: true */ messageListPreferencesFilePath(),
      "r",
    );
    const stats = await handle.stat();
    if (stats.size > MAX_FILE_BYTES) throw new Error("Preferences store is too large.");
    const contents = await handle.readFile();
    if (contents.byteLength > MAX_FILE_BYTES) {
      throw new Error("Preferences store is too large.");
    }
    return messageListPreferencesFileSchema.parse(
      JSON.parse(contents.toString("utf8")),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyFile();
    throw error;
  } finally {
    await handle?.close();
  }
};

export const writeMessageListPreferencesFile = async (
  value: MessageListPreferencesFile,
): Promise<void> => {
  const contents = `${JSON.stringify(
    messageListPreferencesFileSchema.parse(value), null, 2,
  )}\n`;
  if (Buffer.byteLength(contents, "utf8") > MAX_FILE_BYTES) {
    throw new Error("Preferences store is too large.");
  }
  const directory = dataDirectory();
  const temporary = path.join(
    /* turbopackIgnore: true */ directory,
    `.${FILE_NAME}.${crypto.randomUUID()}`,
  );
  await mkdir(/* turbopackIgnore: true */ directory, { mode: 0o700, recursive: true });
  let handle;
  try {
    handle = await open(/* turbopackIgnore: true */ temporary, "wx", 0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(
      /* turbopackIgnore: true */ temporary,
      /* turbopackIgnore: true */ messageListPreferencesFilePath(),
    );
    try {
      const directoryHandle = await open(/* turbopackIgnore: true */ directory, "r");
      await directoryHandle.sync().catch(() => undefined);
      await directoryHandle.close().catch(() => undefined);
    } catch {
      // The atomic rename is committed; directory fsync is best effort.
    }
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(/* turbopackIgnore: true */ temporary).catch(() => undefined);
    throw error;
  }
};
