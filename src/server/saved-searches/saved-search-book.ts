import "server-only";

import {
  MAX_SAVED_SEARCHES,
  type SavedSearch,
  type SavedSearchBook,
  type SavedSearchPutOperation,
} from "@/domain/mail/saved-search";
import { id, type SavedSearchId } from "@/domain/shared/brand";
import { parseStoredSavedSearchBook, type StoredSavedSearchBook } from "@/server/saved-searches/saved-search-record";
import { ApiError } from "@/transport/http/api-error";

const key = (name: string): string => name.normalize("NFKC").trim().toLowerCase();
const notFound = (): never => { throw new ApiError("The saved search was not found.", "SAVED_SEARCH_NOT_FOUND", 404); };
const indexOf = (book: SavedSearchBook, searchId: SavedSearchId): number => {
  const index = book.searches.findIndex(({ id: value }) => value === searchId);
  return index < 0 ? notFound() : index;
};
const assertUniqueName = (book: SavedSearchBook, name: string, excluding?: SavedSearchId): void => {
  if (book.searches.some((search) => search.id !== excluding && key(search.name) === key(name))) {
    throw new ApiError("Each saved search must have a unique name.", "SAVED_SEARCH_NAME_CONFLICT", 422);
  }
};
const finalize = (current: SavedSearchBook, searches: readonly SavedSearch[], now: string): StoredSavedSearchBook =>
  parseStoredSavedSearchBook({ createdAt: current.createdAt ?? now, revision: crypto.randomUUID(),
    searches, updatedAt: now, version: 1 });

export const updateSavedSearchBook = (
  current: SavedSearchBook, operation: SavedSearchPutOperation, now = new Date().toISOString(),
): StoredSavedSearchBook => {
  let searches = [...current.searches];
  if (operation.operation === "create") {
    if (searches.length >= MAX_SAVED_SEARCHES) throw new ApiError(
      `Each identity can contain at most ${MAX_SAVED_SEARCHES} saved searches.`, "SAVED_SEARCH_LIMIT_REACHED", 422,
    );
    assertUniqueName(current, operation.name);
    searches.push({ createdAt: now, id: id.savedSearch(crypto.randomUUID()), name: operation.name,
      query: operation.query, updatedAt: now, version: 1 });
  } else if (operation.operation === "update") {
    const index = indexOf(current, operation.searchId);
    assertUniqueName(current, operation.name, operation.searchId);
    const existing = searches[index]!;
    searches[index] = { ...existing, name: operation.name, query: operation.query, updatedAt: now };
  } else {
    indexOf(current, operation.searchId);
    searches = searches.filter(({ id: value }) => value !== operation.searchId);
  }
  return finalize(current, searches, now);
};
