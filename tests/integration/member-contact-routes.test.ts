import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertRequestRateLimit: vi.fn(),
  assertSubjectRateLimit: vi.fn(),
  get: vi.fn(),
  getAccount: vi.fn(),
  getCurrentConnection: vi.fn(),
  put: vi.fn(),
}));

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.getCurrentConnection,
}));
vi.mock("@/server/mail/gateway-cache", () => ({
  resolveGateway: async () => ({ getAccount: mocks.getAccount }),
}));
vi.mock("@/server/security/rate-limit", () => ({
  assertRequestRateLimit: mocks.assertRequestRateLimit,
  assertSubjectRateLimit: mocks.assertSubjectRateLimit,
}));
vi.mock("@/server/contacts/contact-store", () => ({
  contactStore: { get: mocks.get, put: mocks.put },
}));

import { GET, PUT } from "@/app/api/v1/member/contacts/route";
import {
  type ContactBook,
  MAX_CONTACT_REQUEST_BYTES,
} from "@/domain/member/contact";
import { id } from "@/domain/shared/brand";
import { mailSessionScope } from "@/server/connections/mail-session-scope";

const origin = "https://mail.example.com";
const connection = {
  config: {}, createdAt: "2026-08-04T00:00:00.000Z", displayName: "Mail",
  id: id.connection("contact-route-connection"), providerId: id.provider("mock"),
};
const emptyBook: ContactBook = {
  contacts: [], createdAt: null, groups: [], recents: [], revision: null,
  updatedAt: null, version: 1,
};

const request = (
  method: "GET" | "PUT",
  body?: unknown,
  requestOrigin = origin,
  sessionScope = mailSessionScope(connection),
) => new Request(`${origin}/api/v1/member/contacts`, {
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  headers: {
    ...(body === undefined ? {} : { "content-type": "application/json" }),
    host: "mail.example.com", origin: requestOrigin,
    "x-veda-mail-session-scope": sessionScope,
  },
  method,
});

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getCurrentConnection.mockResolvedValue(connection);
  mocks.getAccount.mockResolvedValue({
    email: "Member@Example.com", id: id.account("member"), name: "Member",
    providerId: id.provider("mock"),
  });
  mocks.get.mockResolvedValue(emptyBook);
  mocks.put.mockResolvedValue({
    ...emptyBook, createdAt: "2026-08-04T01:00:00.000Z",
    revision: "11111111-1111-4111-8111-111111111111",
    updatedAt: "2026-08-04T01:00:00.000Z",
  });
});

describe("member contact routes", () => {
  it("loads the gateway-derived owner with private caching", async () => {
    const response = await GET(request("GET"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.get).toHaveBeenCalledWith({
      email: "Member@Example.com", providerId: "mock",
    });
  });

  it("accepts create and atomic import operations", async () => {
    const contact = {
      emails: [{ email: "person@example.com", label: "Work" }], name: "Person",
    };
    for (const operation of [
      { contact, expectedRevision: null, operation: "create-contact" },
      {
        contacts: [contact], expectedRevision: null,
        groups: [{ contactIndexes: [0], name: "Imported" }],
        operation: "import-contacts",
      },
    ]) {
      const response = await PUT(request("PUT", operation));
      expect(response.status).toBe(201);
      expect(mocks.put).toHaveBeenLastCalledWith(
        { email: "Member@Example.com", providerId: "mock" }, operation,
      );
    }
  });

  it("rejects stale scopes, cross-origin writes, and mass assignment", async () => {
    expect((await GET(request("GET", undefined, origin, "stale"))).status)
      .toBe(409);
    expect((await PUT(request("PUT", {
      contact: { emails: [{ email: "a@example.com", label: null }], name: "A" },
      expectedRevision: null, operation: "create-contact",
    }, "https://attacker.example"))).status).toBe(403);
    expect((await PUT(request("PUT", {
      contact: { emails: [{ email: "a@example.com", label: null }], name: "A" },
      expectedRevision: null, operation: "create-contact",
      ownerEmail: "victim@example.com",
    }))).status).toBe(400);
  });

  it("bounds request bodies before resolving the owner", async () => {
    const response = await PUT(request("PUT", {
      contact: {
        emails: [{ email: "a@example.com", label: null }],
        name: "x".repeat(MAX_CONTACT_REQUEST_BYTES),
      },
      expectedRevision: null,
      operation: "create-contact",
    }));
    expect(response.status).toBe(413);
    expect(mocks.getAccount).not.toHaveBeenCalled();
  });
});
