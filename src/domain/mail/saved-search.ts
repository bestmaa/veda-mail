import type { SavedSearchId } from "@/domain/shared/brand";

export const MAX_SAVED_SEARCHES = 100;
export const MAX_SAVED_SEARCH_NAME_CHARACTERS = 80;
export const MAX_SAVED_SEARCH_NAME_UTF8_BYTES = 256;
export const MAX_SAVED_SEARCH_REQUEST_BYTES = 16 * 1024;

export interface SavedSearch {
  readonly createdAt: string;
  readonly id: SavedSearchId;
  readonly name: string;
  readonly query: string;
  readonly updatedAt: string;
  readonly version: 1;
}

export interface SavedSearchBook {
  readonly createdAt: string | null;
  readonly revision: string | null;
  readonly searches: readonly SavedSearch[];
  readonly updatedAt: string | null;
  readonly version: 1;
}

export interface SavedSearchOwner {
  readonly email: string;
  readonly providerId: string;
}

export type SavedSearchPutOperation =
  | {
      readonly expectedRevision: string | null;
      readonly name: string;
      readonly operation: "create";
      readonly query: string;
    }
  | {
      readonly expectedRevision: string | null;
      readonly name: string;
      readonly operation: "update";
      readonly query: string;
      readonly searchId: SavedSearchId;
    }
  | {
      readonly expectedRevision: string | null;
      readonly operation: "delete";
      readonly searchId: SavedSearchId;
    };
