import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ assertRequestRateLimit: vi.fn(), assertSubjectRateLimit: vi.fn(),
  get: vi.fn(), getAccount: vi.fn(), getCurrentConnection: vi.fn(), put: vi.fn() }));
vi.mock("@/server/connections/connection-session", () => ({ getCurrentConnection: mocks.getCurrentConnection }));
vi.mock("@/server/mail/gateway-cache", () => ({ resolveGateway: async () => ({ getAccount: mocks.getAccount }) }));
vi.mock("@/server/security/rate-limit", () => ({ assertRequestRateLimit: mocks.assertRequestRateLimit,
  assertSubjectRateLimit: mocks.assertSubjectRateLimit }));
vi.mock("@/server/saved-searches/saved-search-store", () => ({ savedSearchStore: { get: mocks.get, put: mocks.put } }));

import { GET, PUT } from "@/app/api/v1/member/saved-searches/route";
import { MAX_SAVED_SEARCH_REQUEST_BYTES, type SavedSearchBook } from "@/domain/mail/saved-search";
import { id } from "@/domain/shared/brand";
import { mailSessionScope } from "@/server/connections/mail-session-scope";

const origin = "https://mail.example.com";
const connection = { config: {}, createdAt: "2026-08-09T00:00:00.000Z", displayName: "Mail",
  id: id.connection("saved-search-route"), providerId: id.provider("mock") };
const emptyBook: SavedSearchBook = { createdAt: null, revision: null, searches: [], updatedAt: null, version: 1 };
const request = (method: "GET" | "PUT", body?: unknown, requestOrigin = origin,
  sessionScope = mailSessionScope(connection)) => new Request(`${origin}/api/v1/member/saved-searches`, {
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  headers: { ...(body === undefined ? {} : { "content-type": "application/json" }),
    host: "mail.example.com", origin: requestOrigin, "x-veda-mail-session-scope": sessionScope }, method,
});
beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getCurrentConnection.mockResolvedValue(connection);
  mocks.getAccount.mockResolvedValue({ email: "Member@Example.com", id: id.account("member"),
    name: "Member", providerId: id.provider("mock") });
  mocks.get.mockResolvedValue(emptyBook);
  mocks.put.mockResolvedValue({ ...emptyBook, createdAt: "2026-08-09T01:00:00.000Z",
    revision: "11111111-1111-4111-8111-111111111111", updatedAt: "2026-08-09T01:00:00.000Z" });
});

describe("member saved-search routes", () => {
  it("loads the gateway-derived owner without shared caching", async () => {
    const response = await GET(request("GET"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.get).toHaveBeenCalledWith({ email: "Member@Example.com", providerId: "mock" });
  });

  it("server-reparses and canonicalizes queries before storing them", async () => {
    const response = await PUT(request("PUT", { expectedRevision: null, name: "Unread",
      operation: "create", query: "  from:ada@example.com   is:unread  " }));
    expect(response.status).toBe(201);
    expect(mocks.put).toHaveBeenCalledWith({ email: "Member@Example.com", providerId: "mock" }, {
      expectedRevision: null, name: "Unread", operation: "create", query: "from:ada@example.com is:unread",
    });
  });

  it("rejects stale scopes, cross-origin writes, invalid queries, and mass assignment", async () => {
    expect((await GET(request("GET", undefined, origin, "stale"))).status).toBe(409);
    const valid = { expectedRevision: null, name: "Unread", operation: "create", query: "is:unread" };
    expect((await PUT(request("PUT", valid, "https://attacker.example"))).status).toBe(403);
    expect((await PUT(request("PUT", { ...valid, ownerEmail: "victim@example.com" }))).status).toBe(400);
    expect((await PUT(request("PUT", { ...valid, query: "after:not-a-date" }))).status).toBe(400);
  });

  it("bounds request bodies before resolving owner identity", async () => {
    const response = await PUT(request("PUT", { expectedRevision: null,
      name: "x".repeat(MAX_SAVED_SEARCH_REQUEST_BYTES), operation: "create", query: "is:unread" }));
    expect(response.status).toBe(413);
    expect(mocks.getAccount).not.toHaveBeenCalled();
  });
});
