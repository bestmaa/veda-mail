import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  getCurrentConnection: vi.fn(),
  parseImport: vi.fn(),
  put: vi.fn(),
}));

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.getCurrentConnection,
}));
vi.mock("@/server/calendar/event-import", () => ({
  parseCalendarEventImport: mocks.parseImport,
}));
vi.mock("@/server/calendar/event-owner", () => ({
  calendarEventOwnerForConnection: async () => ({
    email: "member@example.com",
    providerId: "mock",
  }),
}));
vi.mock("@/server/calendar/event-store", () => ({
  calendarEventStore: { get: mocks.get, put: mocks.put },
}));

import { GET, PUT } from "@/app/api/v1/member/calendar/route";
import type { CalendarEvent } from "@/domain/mail/calendar";
import { id } from "@/domain/shared/brand";
import { mailSessionScope } from "@/server/connections/mail-session-scope";

const origin = "https://mail.example.com";
const connection = {
  config: {},
  createdAt: "2026-08-04T00:00:00.000Z",
  displayName: "Mail",
  id: id.connection("calendar-route-connection"),
  providerId: id.provider("mock"),
};
const instant = (value: string) => ({
  kind: "date-time" as const,
  value,
  zone: { kind: "utc" as const },
});
const event: CalendarEvent = {
  attendees: [],
  description: null,
  dtstamp: instant("2026-08-04T08:00:00"),
  duration: "PT1H",
  endsAt: null,
  location: null,
  organizer: null,
  recurrenceId: null,
  recurrenceRule: null,
  sequence: 1,
  startsAt: instant("2026-08-05T08:00:00"),
  summary: "Planning",
  uid: "event-1@example.com",
};
const emptyBook = {
  createdAt: null,
  events: [],
  revision: null,
  updatedAt: null,
  version: 1 as const,
};

const request = (
  method: "GET" | "PUT",
  body?: unknown,
  requestOrigin = origin,
  scope = mailSessionScope(connection),
) => new Request(`${origin}/api/v1/member/calendar`, {
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
  mocks.get.mockResolvedValue(emptyBook);
  mocks.parseImport.mockReturnValue(event);
  mocks.put.mockResolvedValue({
    ...emptyBook,
    createdAt: "2026-08-04T08:00:00.000Z",
    events: [event],
    revision: "11111111-1111-4111-8111-111111111111",
    updatedAt: "2026-08-04T08:00:00.000Z",
  });
});

describe("member calendar event routes", () => {
  it("returns the owner-scoped event book with private caching", async () => {
    const response = await GET(request("GET"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.get).toHaveBeenCalledWith({
      email: "member@example.com",
      providerId: "mock",
    });
  });

  it("parses and atomically imports exactly one calendar event", async () => {
    const response = await PUT(request("PUT", {
      expectedRevision: null,
      ics: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
      operation: "import-event",
    }));
    expect(response.status).toBe(201);
    expect(mocks.parseImport).toHaveBeenCalledOnce();
    expect(mocks.put).toHaveBeenCalledWith(
      { email: "member@example.com", providerId: "mock" },
      { event, expectedRevision: null, operation: "import-event" },
    );
  });

  it("removes only the supplied canonical identity", async () => {
    const response = await PUT(request("PUT", {
      expectedRevision: "11111111-1111-4111-8111-111111111111",
      operation: "remove-event",
      recurrenceId: null,
      uid: "event-1@example.com",
    }));
    expect(response.status).toBe(200);
    expect(mocks.parseImport).not.toHaveBeenCalled();
    expect(mocks.put).toHaveBeenCalledWith(
      { email: "member@example.com", providerId: "mock" },
      {
        expectedRevision: "11111111-1111-4111-8111-111111111111",
        operation: "remove-event",
        recurrenceId: null,
        uid: "event-1@example.com",
      },
    );
  });

  it("rejects stale scope, cross-origin writes, and mass assignment", async () => {
    expect((await GET(request("GET", undefined, origin, "stale"))).status)
      .toBe(409);
    expect((await PUT(request("PUT", {
      expectedRevision: null,
      ics: "calendar",
      operation: "import-event",
    }, "https://attacker.example"))).status).toBe(403);
    expect((await PUT(request("PUT", {
      expectedRevision: null,
      ics: "calendar",
      operation: "import-event",
      ownerEmail: "victim@example.com",
    }))).status).toBe(400);
    expect(mocks.put).not.toHaveBeenCalled();
  });
});
