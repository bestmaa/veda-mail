import { describe, expect, it } from "vitest";

import { exportCalendarEvents } from "@/server/calendar/event-export";
import { parseCalendarEventImport } from "@/server/calendar/event-import";

const calendar = (method = "PUBLISH", suffix = "") => [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Veda Mail Test//EN",
  `METHOD:${method}`,
  "BEGIN:VEVENT",
  "UID:event-1@example.com",
  "DTSTAMP:20260804T080000Z",
  "DTSTART:20260805T080000Z",
  "DURATION:PT1H",
  "SEQUENCE:1",
  "SUMMARY:Planning",
  "END:VEVENT",
  suffix,
  "END:VCALENDAR",
].filter(Boolean).join("\r\n") + "\r\n";

describe("calendar event import and export", () => {
  it("parses safe canonical fields and exports deterministically", () => {
    const event = parseCalendarEventImport(calendar());
    const first = exportCalendarEvents([event]);
    const second = exportCalendarEvents([event]);
    expect(first).toBe(second);
    expect(first).toContain("METHOD:PUBLISH\r\n");
    expect(first).toContain("UID:event-1@example.com\r\n");
    expect(exportCalendarEvents([])).toMatch(
      /^BEGIN:VCALENDAR\r\n[\s\S]*END:VCALENDAR\r\n$/u,
    );
  });

  it("rejects reply imports and multi-event payloads without partial output", () => {
    expect(() => parseCalendarEventImport(calendar("REPLY"))).toThrow(
      expect.objectContaining({
        code: "CALENDAR_EVENT_IMPORT_INVALID",
        status: 422,
      }),
    );
    const secondEvent = [
      "BEGIN:VEVENT",
      "UID:event-2@example.com",
      "DTSTAMP:20260804T080000Z",
      "DTSTART:20260806T080000Z",
      "SEQUENCE:1",
      "SUMMARY:Second",
      "END:VEVENT",
    ].join("\r\n");
    expect(() => parseCalendarEventImport(calendar("PUBLISH", secondEvent)))
      .toThrow(expect.objectContaining({
        code: "CALENDAR_EVENT_IMPORT_INVALID",
        status: 422,
      }));
  });
});
