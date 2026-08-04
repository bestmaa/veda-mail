import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exportEvents: vi.fn(),
  get: vi.fn(),
  getCurrentConnection: vi.fn(),
}));

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.getCurrentConnection,
}));
vi.mock("@/server/calendar/event-export", () => ({
  exportCalendarEvents: mocks.exportEvents,
}));
vi.mock("@/server/calendar/event-owner", () => ({
  calendarEventOwnerForConnection: async () => ({
    email: "member@example.com",
    providerId: "mock",
  }),
}));
vi.mock("@/server/calendar/event-store", () => ({
  calendarEventStore: { get: mocks.get },
}));

import { GET } from "@/app/api/v1/member/calendar/ics/route";
import { id } from "@/domain/shared/brand";
import { mailSessionScope } from "@/server/connections/mail-session-scope";

const origin = "https://mail.example.com";
const connection = {
  config: {},
  createdAt: "2026-08-04T00:00:00.000Z",
  displayName: "Mail",
  id: id.connection("calendar-export-connection"),
  providerId: id.provider("mock"),
};
const request = (scope = mailSessionScope(connection)) => new Request(
  `${origin}/api/v1/member/calendar/ics`,
  {
    headers: {
      host: "mail.example.com",
      origin,
      "x-veda-mail-session-scope": scope,
    },
  },
);

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getCurrentConnection.mockResolvedValue(connection);
  mocks.get.mockResolvedValue({
    createdAt: null,
    events: [],
    revision: null,
    updatedAt: null,
    version: 1,
  });
  mocks.exportEvents.mockReturnValue(
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n",
  );
});

describe("member calendar event export route", () => {
  it("returns a deterministic private ICS attachment with isolation headers", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-type"))
      .toBe("text/calendar; charset=utf-8");
    expect(response.headers.get("content-disposition"))
      .toContain("veda-mail-calendar.ics");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cross-origin-resource-policy"))
      .toBe("same-origin");
  });

  it("rejects a stale mailbox session scope before reading events", async () => {
    expect((await GET(request("stale"))).status).toBe(409);
    expect(mocks.get).not.toHaveBeenCalled();
  });
});
