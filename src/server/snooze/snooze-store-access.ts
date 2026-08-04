import "server-only";

import type { SnoozeOwner } from "@/domain/mail/snooze";
import {
  decryptSnoozeJobBook,
  encryptSnoozeJobBook,
  snoozeOwnerKey,
} from "@/server/snooze/snooze-crypto";
import { readSnoozeFile, writeSnoozeFile } from "@/server/snooze/snooze-file";
import type { SnoozeJobBook, SnoozeJobFile } from "@/server/snooze/snooze-record";

export const emptySnoozeBook = (): SnoozeJobBook => ({
  jobs: [], mailbox: null, revision: crypto.randomUUID(), version: 1,
});
export const readOwnerSnoozes = async (owner: SnoozeOwner) => {
  const file = await readSnoozeFile();
  const ownerKey = snoozeOwnerKey(owner);
  const encrypted = file.owners[ownerKey];
  return { book: encrypted ? decryptSnoozeJobBook(encrypted, ownerKey) : null,
    file, ownerKey };
};
export const writeOwnerSnoozes = async (
  file: SnoozeJobFile,
  ownerKey: string,
  book: SnoozeJobBook,
): Promise<void> => {
  const owners = { ...file.owners };
  if (book.jobs.length === 0 && book.mailbox === null) delete owners[ownerKey];
  else owners[ownerKey] = encryptSnoozeJobBook(book, ownerKey);
  await writeSnoozeFile({ ...file, owners, updatedAt: new Date().toISOString() });
};
export const readAllSnoozeBooks = async () => {
  const file = await readSnoozeFile();
  const books = new Map<string, SnoozeJobBook>();
  Object.entries(file.owners).forEach(([ownerKey, encrypted]) =>
    books.set(ownerKey, decryptSnoozeJobBook(encrypted, ownerKey)));
  return { books, file };
};
