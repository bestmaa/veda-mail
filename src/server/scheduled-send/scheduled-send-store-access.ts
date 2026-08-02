import "server-only";

import type { ScheduledMessageOwner } from "@/domain/mail/scheduled-send";
import {
  decryptScheduledJobBook,
  encryptScheduledJobBook,
  scheduledJobOwnerKey,
} from "@/server/scheduled-send/scheduled-send-crypto";
import {
  readScheduledJobFile,
  writeScheduledJobFile,
} from "@/server/scheduled-send/scheduled-send-file";
import type {
  ScheduledJobBook,
  ScheduledJobFile,
} from "@/server/scheduled-send/scheduled-send-record";

export const emptyScheduledJobBook = (): ScheduledJobBook => ({
  jobs: [],
  revision: crypto.randomUUID(),
  version: 1,
});

export const readOwnerScheduledJobs = async (
  owner: ScheduledMessageOwner,
): Promise<{
  readonly book: ScheduledJobBook | null;
  readonly file: ScheduledJobFile;
  readonly ownerKey: string;
}> => {
  const file = await readScheduledJobFile();
  const ownerKey = scheduledJobOwnerKey(owner);
  const encrypted = file.owners[ownerKey];
  return {
    book: encrypted ? decryptScheduledJobBook(encrypted, ownerKey) : null,
    file,
    ownerKey,
  };
};

export const writeOwnerScheduledJobs = async (
  file: ScheduledJobFile,
  ownerKey: string,
  book: ScheduledJobBook,
): Promise<void> => {
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
  readonly file: ScheduledJobFile;
  readonly books: ReadonlyMap<string, ScheduledJobBook>;
}> => {
  const file = await readScheduledJobFile();
  const books = new Map<string, ScheduledJobBook>();
  for (const [ownerKey, encrypted] of Object.entries(file.owners)) {
    books.set(ownerKey, decryptScheduledJobBook(encrypted, ownerKey));
  }
  return { books, file };
};
