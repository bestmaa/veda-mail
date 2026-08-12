import "server-only";

import { mkdir, open, rename, unlink } from "node:fs/promises";
import path from "node:path";

import {
  type ScheduledJobFile,
  scheduledJobFileSchema,
} from "@/server/scheduled-send/scheduled-send-record";
import {
  assertScheduledJobKeyCheck,
  scheduledJobKeyCheck,
} from "@/server/scheduled-send/scheduled-send-key";

const FILE_NAME = "scheduled-jobs.json";
export const MAX_SCHEDULED_JOB_FILE_BYTES = 64 * 1024 * 1024;

const dataDirectory = (): string =>
  process.env["VEDA_MAIL_DATA_DIR"] ??
  path.join(/* turbopackIgnore: true */ process.cwd(), "data");

export const scheduledJobFilePath = (): string =>
  path.join(/* turbopackIgnore: true */ dataDirectory(), FILE_NAME);

export const archiveMigratedScheduledJobFile = async (): Promise<void> => {
  try {
    await rename(
      /* turbopackIgnore: true */ scheduledJobFilePath(),
      /* turbopackIgnore: true */ `${scheduledJobFilePath()}.migrated-to-redis`,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
};

const emptyFile = (): ScheduledJobFile => ({
  keyCheck: scheduledJobKeyCheck(),
  owners: {},
  updatedAt: new Date(0).toISOString(),
  version: 1,
});

export const readScheduledJobFile = async (): Promise<ScheduledJobFile> => {
  let handle;
  try {
    handle = await open(/* turbopackIgnore: true */ scheduledJobFilePath(), "r");
    const stats = await handle.stat();
    if (stats.size > MAX_SCHEDULED_JOB_FILE_BYTES) {
      throw new Error("The scheduled-job store exceeds its safe size limit.");
    }
    const contents = await handle.readFile();
    if (contents.byteLength > MAX_SCHEDULED_JOB_FILE_BYTES) {
      throw new Error("The scheduled-job store exceeds its safe size limit.");
    }
    const parsed = scheduledJobFileSchema.parse(
      JSON.parse(contents.toString("utf8")),
    );
    assertScheduledJobKeyCheck(parsed.keyCheck);
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyFile();
    throw error;
  } finally {
    await handle?.close();
  }
};

export const writeScheduledJobFile = async (
  value: ScheduledJobFile,
): Promise<void> => {
  const parsed = scheduledJobFileSchema.parse(value);
  assertScheduledJobKeyCheck(parsed.keyCheck);
  const contents = `${JSON.stringify(parsed, null, 2)}\n`;
  if (Buffer.byteLength(contents, "utf8") > MAX_SCHEDULED_JOB_FILE_BYTES) {
    throw new Error("The scheduled-job store exceeds its safe size limit.");
  }
  const directory = dataDirectory();
  const temporary = path.join(
    /* turbopackIgnore: true */ directory,
    `.${FILE_NAME}.${crypto.randomUUID()}`,
  );
  await mkdir(/* turbopackIgnore: true */ directory, {
    mode: 0o700,
    recursive: true,
  });
  let handle;
  try {
    handle = await open(/* turbopackIgnore: true */ temporary, "wx", 0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(
      /* turbopackIgnore: true */ temporary,
      /* turbopackIgnore: true */ scheduledJobFilePath(),
    );
    const directoryHandle = await open(
      /* turbopackIgnore: true */ directory,
      "r",
    ).catch(() => null);
    await directoryHandle?.sync().catch(() => undefined);
    await directoryHandle?.close().catch(() => undefined);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(/* turbopackIgnore: true */ temporary).catch(() => undefined);
    throw error;
  }
};
