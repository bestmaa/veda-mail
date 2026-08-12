import "server-only";

import type { ScheduledMessageOwner } from "@/domain/mail/scheduled-send";
import {
  decryptScheduledJobBook,
  encryptScheduledJobBook,
  scheduledJobOwnerKey,
} from "@/server/scheduled-send/scheduled-send-crypto";
import {
  archiveMigratedScheduledJobFile,
  readScheduledJobFile,
  writeScheduledJobFile,
} from "@/server/scheduled-send/scheduled-send-file";
import {
  encryptedScheduledJobBookSchema,
  type ScheduledJobBook,
  type ScheduledJobFile,
} from "@/server/scheduled-send/scheduled-send-record";
import { sharedJobRepository } from "@/server/shared-state/shared-job-repository";

let migrationPromise: Promise<boolean> | undefined;
const migrate = async (): Promise<boolean> => {
  const migrated = await sharedJobRepository.ensureMigrated("scheduled-send", async () => {
    const file = await readScheduledJobFile();
    return Object.fromEntries(Object.entries(file.owners).map(([owner, encrypted]) =>
      [owner, JSON.stringify(encrypted)]));
  });
  if (migrated) await archiveMigratedScheduledJobFile();
  return migrated;
};
const ensureMigrated = (): Promise<boolean> => {
  if (!sharedJobRepository.configured()) return Promise.resolve(false);
  migrationPromise ??= migrate();
  return migrationPromise;
};

const decryptSerialized = (serialized: string, ownerKey: string): ScheduledJobBook =>
  decryptScheduledJobBook(
    encryptedScheduledJobBookSchema.parse(JSON.parse(serialized)), ownerKey,
  );

export const emptyScheduledJobBook = (): ScheduledJobBook => ({
  jobs: [],
  revision: crypto.randomUUID(),
  version: 1,
});

export const readOwnerScheduledJobs = async (
  owner: ScheduledMessageOwner,
): Promise<{
  readonly book: ScheduledJobBook | null;
  readonly file: ScheduledJobFile | null;
  readonly ownerCount: number;
  readonly ownerKey: string;
}> => {
  const ownerKey = scheduledJobOwnerKey(owner);
  if (await ensureMigrated()) {
    const serialized = await sharedJobRepository.get("scheduled-send", ownerKey);
    return {
      book: serialized ? decryptSerialized(serialized, ownerKey) : null,
      file: null,
      ownerCount: await sharedJobRepository.count("scheduled-send"),
      ownerKey,
    };
  }
  const file = await readScheduledJobFile();
  const encrypted = file.owners[ownerKey];
  return {
    book: encrypted ? decryptScheduledJobBook(encrypted, ownerKey) : null,
    file,
    ownerCount: Object.keys(file.owners).length,
    ownerKey,
  };
};

export const writeOwnerScheduledJobs = async (
  file: ScheduledJobFile | null,
  ownerKey: string,
  book: ScheduledJobBook,
): Promise<void> => {
  if (sharedJobRepository.configured()) {
    await sharedJobRepository.replace(
      "scheduled-send",
      ownerKey,
      book.jobs.length === 0
        ? null
        : JSON.stringify(encryptScheduledJobBook(book, ownerKey)),
    );
    return;
  }
  if (!file) throw new Error("Scheduled-job file context is missing.");
  const owners = { ...file.owners };
  if (book.jobs.length === 0) delete owners[ownerKey];
  else owners[ownerKey] = encryptScheduledJobBook(book, ownerKey);
  await writeScheduledJobFile({
    ...file,
    owners,
    updatedAt: new Date().toISOString(),
  });
};

export const readAllScheduledJobBooks = async (): Promise<{
  readonly file: ScheduledJobFile | null;
  readonly books: ReadonlyMap<string, ScheduledJobBook>;
}> => {
  if (await ensureMigrated()) {
    const records = await sharedJobRepository.list("scheduled-send");
    const books = new Map<string, ScheduledJobBook>();
    for (const [ownerKey, serialized] of records) {
      books.set(ownerKey, decryptSerialized(serialized, ownerKey));
    }
    return { books, file: null };
  }
  const file = await readScheduledJobFile();
  const books = new Map<string, ScheduledJobBook>();
  for (const [ownerKey, encrypted] of Object.entries(file.owners)) {
    books.set(ownerKey, decryptScheduledJobBook(encrypted, ownerKey));
  }
  return { books, file };
};
