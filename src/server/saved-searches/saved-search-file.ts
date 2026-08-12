import "server-only";

import { mkdir, open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { type SavedSearchFile, savedSearchFileSchema } from "@/server/saved-searches/saved-search-record";

const FILE_NAME = "saved-searches.json";
export const MAX_SAVED_SEARCH_FILE_BYTES = 16 * 1024 * 1024;
const dataDirectory = (): string => process.env["VEDA_MAIL_DATA_DIR"] ??
  path.join(/* turbopackIgnore: true */ process.cwd(), "data");
export const savedSearchFilePath = (): string =>
  path.join(/* turbopackIgnore: true */ dataDirectory(), FILE_NAME);
const emptyFile = (): SavedSearchFile => ({ owners: {}, updatedAt: new Date(0).toISOString(), version: 1 });

export const readSavedSearchFile = async (): Promise<SavedSearchFile> => {
  let handle;
  try {
    handle = await open(/* turbopackIgnore: true */ savedSearchFilePath(), "r");
    const stats = await handle.stat();
    if (stats.size > MAX_SAVED_SEARCH_FILE_BYTES) throw new Error("Saved search store is too large.");
    const contents = await handle.readFile();
    if (contents.byteLength > MAX_SAVED_SEARCH_FILE_BYTES) throw new Error("Saved search store is too large.");
    return savedSearchFileSchema.parse(JSON.parse(contents.toString("utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyFile();
    throw error;
  } finally { await handle?.close(); }
};

export const writeSavedSearchFile = async (value: SavedSearchFile): Promise<void> => {
  const parsed = savedSearchFileSchema.parse(value);
  const contents = `${JSON.stringify(parsed, null, 2)}\n`;
  if (Buffer.byteLength(contents, "utf8") > MAX_SAVED_SEARCH_FILE_BYTES) throw new Error("Saved search store is too large.");
  const directory = dataDirectory();
  const temporary = path.join(/* turbopackIgnore: true */ directory, `.${FILE_NAME}.${crypto.randomUUID()}`);
  await mkdir(/* turbopackIgnore: true */ directory, { mode: 0o700, recursive: true });
  let handle;
  try {
    handle = await open(/* turbopackIgnore: true */ temporary, "wx", 0o600);
    await handle.writeFile(contents, "utf8"); await handle.sync(); await handle.close(); handle = undefined;
    await rename(/* turbopackIgnore: true */ temporary, /* turbopackIgnore: true */ savedSearchFilePath());
    try {
      const directoryHandle = await open(/* turbopackIgnore: true */ directory, "r");
      await directoryHandle.sync().catch(() => undefined); await directoryHandle.close().catch(() => undefined);
    } catch { /* Atomic rename has already committed. */ }
  } catch (error) {
    await handle?.close().catch(() => undefined); await unlink(/* turbopackIgnore: true */ temporary).catch(() => undefined); throw error;
  }
};

export const archiveMigratedSavedSearchFile = async (): Promise<void> => {
  try {
    await rename(
      /* turbopackIgnore: true */ savedSearchFilePath(),
      /* turbopackIgnore: true */ `${savedSearchFilePath()}.migrated-to-redis`,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
};
