import "server-only";

import { installationStore } from "@/server/installation/installation.store";
import {
  type CalendarEventPutOperation,
  updateCalendarEventBook,
} from "@/server/calendar/event-book";
import {
  calendarEventOwnerKey,
  decryptCalendarEventBook,
  encryptCalendarEventBook,
} from "@/server/calendar/event-crypto";
import {
  archiveMigratedCalendarEventFile,
  readCalendarEventFile,
  writeCalendarEventFile,
} from "@/server/calendar/event-file";
import type { CalendarEventOwner } from "@/server/calendar/event-owner";
import {
  type CalendarEventBook,
  emptyCalendarEventBook,
  encryptedCalendarEventBookSchema,
  MAX_CALENDAR_EVENT_OWNERS,
  type StoredCalendarEventBook,
} from "@/server/calendar/event-record";
import { sharedOwnerRepository } from
  "@/server/shared-state/shared-owner-repository";
import { ApiError } from "@/transport/http/api-error";

const globalState = globalThis as typeof globalThis & {
  __vedaMailCalendarEventQueue?: Promise<void>;
};
globalState.__vedaMailCalendarEventQueue ??= Promise.resolve();
let migrationPromise: Promise<boolean> | undefined;

const serialized = async <T>(task: () => Promise<T>): Promise<T> => {
  const result = globalState.__vedaMailCalendarEventQueue!.then(task, task);
  globalState.__vedaMailCalendarEventQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

const unavailable = (): never => {
  throw new ApiError(
    "Calendar events are temporarily unavailable.",
    "CALENDAR_EVENT_STORE_UNAVAILABLE",
    500,
  );
};

const secret = async (): Promise<string> => {
  let installation;
  try {
    installation = await installationStore.get();
  } catch {
    return unavailable();
  }
  if (!installation) {
    throw new ApiError(
      "Complete setup before managing calendar events.",
      "SETUP_REQUIRED",
      503,
    );
  }
  return installation.sessionSecret;
};

const currentBook = async (
  owner: CalendarEventOwner,
  sessionSecret: string,
) => {
  try {
    const file = await readCalendarEventFile();
    const ownerKey = calendarEventOwnerKey(owner, sessionSecret);
    const encrypted = file.owners[ownerKey];
    return {
      book: encrypted
        ? decryptCalendarEventBook(encrypted, ownerKey, sessionSecret)
        : emptyCalendarEventBook(),
      file,
      ownerKey,
    };
  } catch {
    return unavailable();
  }
};

const ensureMigrated = (): Promise<boolean> => {
  if (!sharedOwnerRepository.configured()) return Promise.resolve(false);
  migrationPromise ??= sharedOwnerRepository.ensureMigrated(
    "calendar-events",
    async () => {
      const file = await readCalendarEventFile();
      return Object.fromEntries(Object.entries(file.owners)
        .map(([owner, value]) => [owner, JSON.stringify(value)]));
    },
    archiveMigratedCalendarEventFile,
  );
  return migrationPromise;
};

const sharedMode = async (): Promise<boolean> => {
  try { return await ensureMigrated(); }
  catch { return unavailable(); }
};

const sharedCurrentBook = async (
  owner: CalendarEventOwner, sessionSecret: string,
) => {
  const ownerKey = calendarEventOwnerKey(owner, sessionSecret);
  const serializedRecord = await sharedOwnerRepository.get(
    "calendar-events", ownerKey,
  );
  const encrypted = serializedRecord
    ? encryptedCalendarEventBookSchema.parse(JSON.parse(serializedRecord))
    : undefined;
  return {
    book: encrypted
      ? decryptCalendarEventBook(encrypted, ownerKey, sessionSecret)
      : emptyCalendarEventBook(),
    ownerKey,
    serializedRecord,
  };
};

const assertRevision = (
  book: CalendarEventBook,
  expectedRevision: string | null,
): void => {
  if (book.revision !== expectedRevision) {
    conflict();
  }
};

const conflict = (): never => {
  throw new ApiError(
    "Calendar events changed in another session. Reload and try again.",
    "CALENDAR_EVENT_BOOK_CONFLICT",
    409,
  );
};

const assertOwnerCapacity = (
  owners: Readonly<Record<string, unknown>>,
  ownerKey: string,
): void => {
  if (owners[ownerKey] === undefined &&
      Object.keys(owners).length >= MAX_CALENDAR_EVENT_OWNERS) {
    throw new ApiError(
      "The installation cannot store another calendar owner.",
      "CALENDAR_EVENT_OWNER_LIMIT_REACHED",
      507,
    );
  }
};

const persist = async (
  current: Awaited<ReturnType<typeof currentBook>>,
  updated: StoredCalendarEventBook,
  sessionSecret: string,
): Promise<CalendarEventBook> => {
  const owners = { ...current.file.owners };
  owners[current.ownerKey] = encryptCalendarEventBook(
    updated,
    current.ownerKey,
    sessionSecret,
  );
  try {
    await writeCalendarEventFile({
      ...current.file,
      owners,
      updatedAt: updated.updatedAt,
    });
  } catch {
    return unavailable();
  }
  return updated;
};

export const calendarEventStore = {
  async get(owner: CalendarEventOwner): Promise<CalendarEventBook> {
    const sessionSecret = await secret();
    try {
      return await sharedMode()
        ? (await sharedCurrentBook(owner, sessionSecret)).book
        : (await currentBook(owner, sessionSecret)).book;
    } catch {
      return unavailable();
    }
  },

  async put(
    owner: CalendarEventOwner,
    operation: CalendarEventPutOperation,
  ): Promise<CalendarEventBook> {
    return serialized(async () => {
      const sessionSecret = await secret();
      if (await sharedMode()) {
        let current;
        try { current = await sharedCurrentBook(owner, sessionSecret); }
        catch { return unavailable(); }
        assertRevision(current.book, operation.expectedRevision);
        const updated = updateCalendarEventBook(current.book, operation);
        if (updated === current.book) return current.book;
        let replaced;
        try {
          replaced = await sharedOwnerRepository.compareAndSet(
            "calendar-events", current.ownerKey, current.serializedRecord,
            JSON.stringify(encryptCalendarEventBook(
              updated as StoredCalendarEventBook,
              current.ownerKey, sessionSecret,
            )),
          );
        } catch { return unavailable(); }
        if (!replaced) conflict();
        return updated;
      }
      const current = await currentBook(owner, sessionSecret);
      assertRevision(current.book, operation.expectedRevision);
      assertOwnerCapacity(current.file.owners, current.ownerKey);
      const updated = updateCalendarEventBook(current.book, operation);
      if (updated === current.book) return current.book;
      return persist(current, updated as StoredCalendarEventBook, sessionSecret);
    });
  },
};
