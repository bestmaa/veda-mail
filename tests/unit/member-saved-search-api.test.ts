import { afterEach, describe, expect, it, vi } from "vitest";
import type { SavedSearchBook } from "@/domain/mail/saved-search";
import { memberSavedSearchApi } from "@/transport/client/member-saved-search-api";

const empty: SavedSearchBook = { createdAt: null, revision: null, searches: [], updatedAt: null, version: 1 };
const scope = "saved-search-test-scope";
afterEach(() => vi.unstubAllGlobals());

describe("member saved-search API", () => {
  it("loads without browser caching and sends scoped CAS mutations", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ data: empty }));
    vi.stubGlobal("fetch", fetch);
    await memberSavedSearchApi.get(scope);
    expect(fetch).toHaveBeenLastCalledWith("/api/v1/member/saved-searches", expect.objectContaining({
      cache: "no-store", credentials: "same-origin", headers: { "x-veda-mail-session-scope": scope }, method: "GET",
    }));
    const operation = { expectedRevision: "11111111-1111-4111-8111-111111111111",
      name: "Unread", operation: "create" as const, query: "is:unread" };
    await memberSavedSearchApi.put(operation, scope);
    const init = fetch.mock.calls[1]?.[1] as RequestInit;
    expect(init).toMatchObject({ body: JSON.stringify(operation), credentials: "same-origin", method: "PUT" });
    expect(init.headers).toEqual({ "Content-Type": "application/json", "x-veda-mail-session-scope": scope });
  });

  it("preserves typed revision and session failures", async () => {
    for (const failure of [
      { code: "SAVED_SEARCH_BOOK_CONFLICT", status: 409 },
      { code: "MEMBER_SESSION_EXPIRED", status: 401 },
    ]) {
      vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: {
        code: failure.code, message: "Reload required.",
      } }, { status: failure.status })));
      await expect(memberSavedSearchApi.get(scope)).rejects.toMatchObject({
        code: failure.code, name: "MemberSavedSearchApiError", status: failure.status,
      });
    }
  });
});
