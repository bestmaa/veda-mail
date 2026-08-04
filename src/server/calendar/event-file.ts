import "server-only";

import { mkdir, open, rename, unlink } from "node:fs/promises";
import path from "node:path";

import {
  type CalendarEventFile,
  calendarEventFileSchema,
} from "@/server/calendar/event-record";

const FILE_NAME = "member-calendar-events.json";
export const MAX_CALENDAR_EVENT_FILE_BYTES = 64 * 1024 * 1024;

const dataDirectory = (): string =>
  process.env["VEDA_MAIL_DATA_DIR"] ??
  path.join(/* turbopackIgnore: true */ process.cwd(), "data");

export const calendarEventFilePath = (): string =>
  path.join(/* turbopackIgnore: true */ dataDirectory(), FILE_NAME);

const emptyFile = (): CalendarEventFile => ({
  owners: {},
  updatedAt: new Date(0).toISOString(),
  version: 1,
});

export const readCalendarEventFile = async (): Promise<CalendarEventFile> => {
  let handle;
  try {
    handle = await open(
      /* turbopackIgnore: true */ calendarEventFilePath(),
      "r",
    );
    const stats = await handle.stat();
    if (stats.size > MAX_CALENDAR_EVENT_FILE_BYTES) {
      throw new Error("The calendar-event store exceeds its safe size limit.");
    }
    const contents = await handle.readFile();
    if (contents.byteLength > MAX_CALENDAR_EVENT_FILE_BYTES) {
      throw new Error("The calendar-event store exceeds its safe size limit.");
    }
    return calendarEventFileSchema.parse(JSON.parse(contents.toString("utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyFile();
    throw error;
  } finally {
    await handle?.close();
  }
};

export const writeCalendarEventFile = async (
  value: CalendarEventFile,
): Promise<void> => {
  const parsed = calendarEventFileSchema.parse(value);
  const contents = `${JSON.stringify(parsed, null, 2)}\n`;
  if (Buffer.byteLength(contents, "utf8") > MAX_CALENDAR_EVENT_FILE_BYTES) {
    throw new Error("The calendar-event store exceeds its safe size limit.");
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
      /* turbopackIgnore: true */ calendarEventFilePath(),
    );
    try {
      const directoryHandle = await open(
        /* turbopackIgnore: true */ directory,
        "r",
      );
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
