import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertRequestRateLimit: vi.fn(),
  assertSubjectRateLimit: vi.fn(),
  get: vi.fn(),
  getCurrentConnection: vi.fn(),
  put: vi.fn(),
}));

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.getCurrentConnection,
}));
vi.mock("@/server/contacts/contact-owner", () => ({
  contactOwnerForConnection: async () => ({
    email: "member@example.com",
    providerId: "mock",
  }),
}));
vi.mock("@/server/contacts/contact-store", () => ({
  contactStore: { get: mocks.get, put: mocks.put },
}));
vi.mock("@/server/security/rate-limit", () => ({
  assertRequestRateLimit: mocks.assertRequestRateLimit,
  assertSubjectRateLimit: mocks.assertSubjectRateLimit,
}));
vi.mock("@/server/security-audit/security-audit", () => ({ appendSecurityAudit: vi.fn(), memberAuditActor: vi.fn(() => ({ actorId: "audit", actorType: "member" })) }));

import { GET, POST } from "@/app/api/v1/member/contacts/vcard/route";
import type { ContactBook } from "@/domain/member/contact";
import { id } from "@/domain/shared/brand";
import { mailSessionScope } from "@/server/connections/mail-session-scope";

const origin = "https://mail.example.com";
const connection = {
  config: {}, createdAt: "2026-08-04T00:00:00.000Z", displayName: "Mail",
  id: id.connection("vcard-route-connection"), providerId: id.provider("mock"),
};
const contactId = id.contact("00000000-0000-4000-8000-000000000001");
const book: ContactBook = {
  contacts: [{
    createdAt: "2026-08-04T00:00:00.000Z",
    emails: [{ email: "ada@example.com", label: "work" }],
    id: contactId,
    name: "Ada Lovelace",
    updatedAt: "2026-08-04T00:00:00.000Z",
    version: 1,
  }],
  createdAt: "2026-08-04T00:00:00.000Z",
  groups: [{
    contactIds: [contactId],
    createdAt: "2026-08-04T00:00:00.000Z",
    id: id.contactGroup("00000000-0000-4000-8000-000000000002"),
    name: "Engineering Team",
    updatedAt: "2026-08-04T00:00:00.000Z",
    version: 1,
  }],
  recents: [],
  revision: "11111111-1111-4111-8111-111111111111",
  updatedAt: "2026-08-04T00:00:00.000Z",
  version: 1,
};

const request = (
  method: "GET" | "POST",
  body?: unknown,
  requestOrigin = origin,
  scope = mailSessionScope(connection),
) => new Request(`${origin}/api/v1/member/contacts/vcard`, {
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  headers: {
    ...(body === undefined ? {} : { "content-type": "application/json" }),
    host: "mail.example.com",
    origin: requestOrigin,
    "x-veda-mail-session-scope": scope,
  },
  method,
});

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getCurrentConnection.mockResolvedValue(connection);
  mocks.get.mockResolvedValue(book);
  mocks.put.mockResolvedValue(book);
});

describe("member contact vCard routes", () => {
  it("exports a no-store vCard with group categories", async () => {
    const response = await GET(request("GET"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/vcard; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toContain("veda-mail-contacts.vcf");
    const text = await response.text();
    expect(text).toContain("FN:Ada Lovelace\r\n");
    expect(text).toContain("EMAIL;TYPE=WORK:ada@example.com\r\n");
    expect(text).toContain("CATEGORIES:Engineering Team\r\n");
  });

  it("imports contacts and category groups in one optimistic write", async () => {
    const vcard = [
      "BEGIN:VCARD", "VERSION:4.0", "FN:Ada Lovelace",
      "EMAIL;TYPE=work:ada@example.com", "CATEGORIES:Engineering", "END:VCARD",
      "BEGIN:VCARD", "VERSION:4.0", "FN:Grace Hopper",
      "EMAIL:grace@example.com", "CATEGORIES:Engineering,Pioneers", "END:VCARD", "",
    ].join("\r\n");
    const response = await POST(request("POST", {
      expectedRevision: book.revision,
      vcard,
    }));
    expect(response.status).toBe(201);
    expect(mocks.put).toHaveBeenCalledWith(
      { email: "member@example.com", providerId: "mock" },
      {
        contacts: [
          { emails: [{ email: "ada@example.com", label: "work" }], name: "Ada Lovelace" },
          { emails: [{ email: "grace@example.com", label: null }], name: "Grace Hopper" },
        ],
        expectedRevision: book.revision,
        groups: [
          { contactIndexes: [0, 1], name: "Engineering" },
          { contactIndexes: [1], name: "Pioneers" },
        ],
        operation: "import-contacts",
      },
    );
  });

  it("rejects malformed cards and cards above the domain email limit", async () => {
    expect((await POST(request("POST", {
      expectedRevision: book.revision,
      vcard: "BEGIN:VCARD\r\nVERSION:2.1\r\nEND:VCARD\r\n",
    }))).status).toBe(422);
    const emails = Array.from({ length: 6 }, (_, index) =>
      `EMAIL:user${index}@example.com`).join("\r\n");
    expect((await POST(request("POST", {
      expectedRevision: book.revision,
      vcard: `BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Many\r\n${emails}\r\nEND:VCARD\r\n`,
    }))).status).toBe(422);
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("rejects stale session scopes and cross-origin imports", async () => {
    expect((await GET(request("GET", undefined, origin, "stale"))).status).toBe(409);
    expect((await POST(request("POST", {
      expectedRevision: book.revision,
      vcard: "BEGIN:VCARD\r\nVERSION:4.0\r\nFN:A\r\nEMAIL:a@example.com\r\nEND:VCARD\r\n",
    }, "https://attacker.example"))).status).toBe(403);
    expect(mocks.put).not.toHaveBeenCalled();
  });
});
