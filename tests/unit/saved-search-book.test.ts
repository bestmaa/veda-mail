import { describe, expect, it } from "vitest";
import type { SavedSearchBook } from "@/domain/mail/saved-search";
import { updateSavedSearchBook } from "@/server/saved-searches/saved-search-book";
import { parseSavedSearchPutOperation } from "@/server/saved-searches/saved-search-schema";

const empty: SavedSearchBook = {
  createdAt: null, revision: null, searches: [], updatedAt: null, version: 1,
};

describe("saved search book", () => {
  it("canonicalizes, creates, updates, and deletes searches with fresh revisions", () => {
    const create = parseSavedSearchPutOperation({ expectedRevision: null,
      name: " Important ", operation: "create", query: "  from:ADA@example.com   is:unread " });
    const created = updateSavedSearchBook(empty, create, "2026-08-09T00:00:00.000Z");
    expect(created.searches[0]).toMatchObject({ name: "Important", query: "from:ADA@example.com is:unread" });
    const searchId = created.searches[0]!.id;
    const updated = updateSavedSearchBook(created, parseSavedSearchPutOperation({
      expectedRevision: created.revision, name: "Unread from Ada", operation: "update",
      query: "is:unread from:ADA@example.com", searchId,
    }), "2026-08-09T00:01:00.000Z");
    expect(updated.revision).not.toBe(created.revision);
    expect(updated.searches[0]).toMatchObject({ name: "Unread from Ada", query: "is:unread from:ADA@example.com" });
    const deleted = updateSavedSearchBook(updated, { expectedRevision: updated.revision,
      operation: "delete", searchId }, "2026-08-09T00:02:00.000Z");
    expect(deleted.searches).toEqual([]);
  });

  it("rejects duplicate normalized names, invalid queries, and mass assignment", () => {
    const first = updateSavedSearchBook(empty, parseSavedSearchPutOperation({
      expectedRevision: null, name: "Unread", operation: "create", query: "is:unread",
    }));
    expect(() => updateSavedSearchBook(first, parseSavedSearchPutOperation({
      expectedRevision: first.revision, name: " unread ", operation: "create", query: "is:starred",
    }))).toThrowError(expect.objectContaining({ code: "SAVED_SEARCH_NAME_CONFLICT" }));
    expect(() => parseSavedSearchPutOperation({ expectedRevision: null,
      name: "Broken", operation: "create", query: "after:not-a-date" })).toThrow();
    expect(() => parseSavedSearchPutOperation({ expectedRevision: null,
      name: "Injected", operation: "create", ownerEmail: "victim@example.com", query: "is:unread" })).toThrow();
  });
});
