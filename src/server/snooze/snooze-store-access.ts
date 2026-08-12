import "server-only";

import type { SnoozeOwner } from "@/domain/mail/snooze";
import {
  decryptSnoozeJobBook,
  encryptSnoozeJobBook,
  snoozeOwnerKey,
} from "@/server/snooze/snooze-crypto";
import { archiveMigratedSnoozeFile, readSnoozeFile,
  writeSnoozeFile } from "@/server/snooze/snooze-file";
import {
  encryptedSnoozeJobBookSchema,
  type SnoozeJobBook,
  type SnoozeJobFile,
} from "@/server/snooze/snooze-record";
import { sharedJobRepository } from "@/server/shared-state/shared-job-repository";

let migrationPromise: Promise<boolean> | undefined;
const migrate = async (): Promise<boolean> => {
  const migrated = await sharedJobRepository.ensureMigrated("snooze", async () => {
    const file = await readSnoozeFile();
    return Object.fromEntries(Object.entries(file.owners).map(([owner, encrypted]) =>
      [owner, JSON.stringify(encrypted)]));
  });
  if (migrated) await archiveMigratedSnoozeFile();
  return migrated;
};
const ensureMigrated = (): Promise<boolean> => {
  if (!sharedJobRepository.configured()) return Promise.resolve(false);
  migrationPromise ??= migrate();
  return migrationPromise;
};
const decryptSerialized = (serialized: string, ownerKey: string): SnoozeJobBook =>
  decryptSnoozeJobBook(
    encryptedSnoozeJobBookSchema.parse(JSON.parse(serialized)), ownerKey,
  );

export const emptySnoozeBook = (): SnoozeJobBook => ({
  jobs: [], mailbox: null, revision: crypto.randomUUID(), version: 1,
});
export const readOwnerSnoozes = async (owner: SnoozeOwner) => {
  const ownerKey = snoozeOwnerKey(owner);
  if (await ensureMigrated()) {
    const serialized = await sharedJobRepository.get("snooze", ownerKey);
    return { book: serialized ? decryptSerialized(serialized, ownerKey) : null,
      file: null, ownerCount: await sharedJobRepository.count("snooze"), ownerKey };
  }
  const file = await readSnoozeFile();
  const encrypted = file.owners[ownerKey];
  return { book: encrypted ? decryptSnoozeJobBook(encrypted, ownerKey) : null,
    file, ownerCount: Object.keys(file.owners).length, ownerKey };
};
export const writeOwnerSnoozes = async (
  file: SnoozeJobFile | null,
  ownerKey: string,
  book: SnoozeJobBook,
): Promise<void> => {
  if (sharedJobRepository.configured()) {
    const keep = book.jobs.length > 0 || book.mailbox !== null;
    await sharedJobRepository.replace("snooze", ownerKey,
      keep ? JSON.stringify(encryptSnoozeJobBook(book, ownerKey)) : null);
    return;
  }
  if (!file) throw new Error("Snooze file context is missing.");
  const owners = { ...file.owners };
  if (book.jobs.length === 0 && book.mailbox === null) delete owners[ownerKey];
  else owners[ownerKey] = encryptSnoozeJobBook(book, ownerKey);
  await writeSnoozeFile({ ...file, owners, updatedAt: new Date().toISOString() });
};
export const readAllSnoozeBooks = async () => {
  if (await ensureMigrated()) {
    const records = await sharedJobRepository.list("snooze");
    const books = new Map<string, SnoozeJobBook>();
    for (const [ownerKey, serialized] of records) {
      books.set(ownerKey, decryptSerialized(serialized, ownerKey));
    }
    return { books, file: null };
  }
  const file = await readSnoozeFile();
  const books = new Map<string, SnoozeJobBook>();
  Object.entries(file.owners).forEach(([ownerKey, encrypted]) =>
    books.set(ownerKey, decryptSnoozeJobBook(encrypted, ownerKey)));
  return { books, file };
};
