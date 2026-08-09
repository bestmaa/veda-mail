import "server-only";

import type { SavedSearchBook, SavedSearchOwner, SavedSearchPutOperation } from "@/domain/mail/saved-search";
import { installationStore } from "@/server/installation/installation.store";
import { updateSavedSearchBook } from "@/server/saved-searches/saved-search-book";
import { decryptSavedSearchBook, encryptSavedSearchBook, savedSearchOwnerKey } from "@/server/saved-searches/saved-search-crypto";
import { readSavedSearchFile, writeSavedSearchFile } from "@/server/saved-searches/saved-search-file";
import { emptySavedSearchBook, MAX_SAVED_SEARCH_OWNERS } from "@/server/saved-searches/saved-search-record";
import { ApiError } from "@/transport/http/api-error";

const globalState = globalThis as typeof globalThis & { __vedaMailSavedSearchQueue?: Promise<void> };
globalState.__vedaMailSavedSearchQueue ??= Promise.resolve();
const serialized = async <T>(task: () => Promise<T>): Promise<T> => {
  const result = globalState.__vedaMailSavedSearchQueue!.then(task, task);
  globalState.__vedaMailSavedSearchQueue = result.then(() => undefined, () => undefined);
  return result;
};
const unavailable = (): never => { throw new ApiError(
  "Saved searches are temporarily unavailable.", "SAVED_SEARCH_STORE_UNAVAILABLE", 500,
); };
const secret = async (): Promise<string> => {
  let installation;
  try { installation = await installationStore.get(); } catch { return unavailable(); }
  if (!installation) throw new ApiError("Complete setup before managing saved searches.", "SETUP_REQUIRED", 503);
  return installation.sessionSecret;
};
const conflict = (): never => { throw new ApiError(
  "Saved searches changed in another session. Reload and try again.", "SAVED_SEARCH_BOOK_CONFLICT", 409,
); };
const currentBook = async (owner: SavedSearchOwner, sessionSecret: string) => {
  try {
    const file = await readSavedSearchFile();
    const ownerKey = savedSearchOwnerKey(owner, sessionSecret);
    const encrypted = file.owners[ownerKey];
    return { book: encrypted ? decryptSavedSearchBook(encrypted, ownerKey, sessionSecret) : emptySavedSearchBook(), file, ownerKey };
  } catch { return unavailable(); }
};
const assertCapacity = (owners: Readonly<Record<string, unknown>>, ownerKey: string): void => {
  if (owners[ownerKey] === undefined && Object.keys(owners).length >= MAX_SAVED_SEARCH_OWNERS) {
    throw new ApiError("The installation cannot store another saved-search owner.", "SAVED_SEARCH_OWNER_LIMIT_REACHED", 507);
  }
};

export const savedSearchStore = {
  async get(owner: SavedSearchOwner): Promise<SavedSearchBook> {
    const sessionSecret = await secret();
    return (await currentBook(owner, sessionSecret)).book;
  },
  async put(owner: SavedSearchOwner, operation: SavedSearchPutOperation): Promise<SavedSearchBook> {
    return serialized(async () => {
      const sessionSecret = await secret();
      const current = await currentBook(owner, sessionSecret);
      if (current.book.revision !== operation.expectedRevision) conflict();
      assertCapacity(current.file.owners, current.ownerKey);
      let updated;
      try { updated = updateSavedSearchBook(current.book, operation); }
      catch (error) { if (error instanceof ApiError) throw error; return unavailable(); }
      const owners = { ...current.file.owners };
      if (updated.searches.length === 0) delete owners[current.ownerKey];
      else owners[current.ownerKey] = encryptSavedSearchBook(updated, current.ownerKey, sessionSecret);
      try { await writeSavedSearchFile({ ...current.file, owners, updatedAt: updated.updatedAt }); }
      catch { return unavailable(); }
      return updated.searches.length === 0 ? emptySavedSearchBook() : updated;
    });
  },
};
