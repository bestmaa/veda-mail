import { describe, expect, it } from "vitest";

import { CALENDAR_LIMITS } from "@/server/calendar/calendar-limits";
import {
  CalendarParseError,
  parseCalendarInvitation,
} from "@/server/calendar/calendar-parser";

const calendar = (method: string, event: readonly string[]): string => [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Example Corp//Calendar 1.0//EN",
  `METHOD:${method}`,
  "BEGIN:VEVENT",
  ...event,
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");

const requestEvent = [
  "UID:meeting-42@example.com",
  "SEQUENCE:7",
  "DTSTAMP:20260804T101112Z",
  "DTSTART;TZID=America/New_York:20260810T090000",
  "DTEND;TZID=America/New_York:20260810T100000",
  "RRULE:BYDAY=MO,WE;COUNT=10;INTERVAL=2;FREQ=WEEKLY",
  "SUMMARY:Architecture review",
  "DESCRIPTION:First line\\nSecond long line that is safely ",
  " folded across transport content lines.",
  "LOCATION:Room 4\\, North",
  'ORGANIZER;CN="Ada Lovelace":mailto:ada@example.com',
  'ATTENDEE;CN="Grace Hopper";PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:grace@example.net',
] as const;

describe("bounded iCalendar invitation parser", () => {
  it("parses a folded recurring REQUEST into safe display metadata", () => {
    const parsed = parseCalendarInvitation(calendar("REQUEST", requestEvent));

    expect(parsed).toMatchObject({
      method: "REQUEST",
      productId: "-//Example Corp//Calendar 1.0//EN",
      event: {
        attendees: [{
          email: "grace@example.net",
          name: "Grace Hopper",
          participationStatus: "NEEDS-ACTION",
          rsvp: true,
        }],
        description:
          "First line\nSecond long line that is safely folded across transport content lines.",
        dtstamp: {
          kind: "date-time",
          value: "2026-08-04T10:11:12",
          zone: { kind: "utc" },
        },
        endsAt: {
          kind: "date-time",
          value: "2026-08-10T10:00:00",
          zone: { id: "America/New_York", kind: "iana" },
        },
        location: "Room 4, North",
        organizer: { email: "ada@example.com", name: "Ada Lovelace" },
        recurrenceRule: {
          canonical: "FREQ=WEEKLY;INTERVAL=2;COUNT=10;BYDAY=MO,WE",
          summary: "Every 2 week; 10 occurrences; on MO,WE",
        },
        sequence: 7,
        startsAt: {
          kind: "date-time",
          value: "2026-08-10T09:00:00",
          zone: { id: "America/New_York", kind: "iana" },
        },
        summary: "Architecture review",
        uid: "meeting-42@example.com",
      },
    });
  });

  it.each([
    ["CANCEL", [...requestEvent]],
    ["PUBLISH", requestEvent.filter((line) =>
      !line.startsWith("ORGANIZER") && !line.startsWith("ATTENDEE"))],
    ["REPLY", requestEvent.map((line) =>
      line.startsWith("ATTENDEE")
        ? "ATTENDEE;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:grace@example.net"
        : line)],
  ])("supports safe %s display metadata", (method, event) => {
    expect(parseCalendarInvitation(calendar(method, event)).method).toBe(method);
  });

  it("supports all-day duration and floating date-time markers", () => {
    const allDay = parseCalendarInvitation(calendar("PUBLISH", [
      "UID:holiday@example.com",
      "DTSTAMP:20260804T101112Z",
      "DTSTART;VALUE=DATE:20261225",
      "DURATION:P1D",
      "SUMMARY:Holiday",
    ]));
    const floating = parseCalendarInvitation(calendar("PUBLISH", [
      "UID:floating@example.com",
      "DTSTAMP:20260804T101112Z",
      "DTSTART:20260810T090000",
      "SUMMARY:Local appointment",
    ]));

    expect(allDay.event.startsAt).toEqual({ kind: "date", value: "2026-12-25" });
    expect(allDay.event.duration).toBe("P1D");
    expect(floating.event.startsAt).toMatchObject({ zone: { kind: "floating" } });
  });

  it("ignores bounded VTIMEZONE and VALARM metadata without fetching", () => {
    const input = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "METHOD:REQUEST",
      "BEGIN:VTIMEZONE", "TZID:America/New_York",
      "BEGIN:STANDARD", "DTSTART:19701101T020000", "END:STANDARD",
      "END:VTIMEZONE", "BEGIN:VEVENT", ...requestEvent,
      "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT15M",
      "DESCRIPTION:Reminder", "ATTACH:https://example.com/tone.wav",
      "END:VALARM", "END:VEVENT", "END:VCALENDAR", "",
    ].join("\r\n");

    expect(parseCalendarInvitation(input).event.summary).toBe("Architecture review");
  });

  it.each([
    ["multiple events", calendar("PUBLISH", requestEvent).replace(
      "END:VCALENDAR", "BEGIN:VEVENT\r\nUID:two\r\nDTSTAMP:20260804T101112Z\r\nDTSTART:20260810T090000\r\nEND:VEVENT\r\nEND:VCALENDAR",
    )],
    ["duplicate UID", calendar("REQUEST", [...requestEvent, "UID:duplicate"])],
    ["malformed escape", calendar("REQUEST", requestEvent.map((line) =>
      line.startsWith("SUMMARY") ? "SUMMARY:bad\\qescape" : line))],
    ["unsupported encoding", calendar("REQUEST", requestEvent.map((line) =>
      line.startsWith("DESCRIPTION") ? "DESCRIPTION;ENCODING=BASE64:SGk=" : line))],
    ["dangerous URI", calendar("REQUEST", [...requestEvent, "ATTACH:file:///etc/passwd"])],
    ["non-mailto organizer", calendar("REQUEST", requestEvent.map((line) =>
      line.startsWith("ORGANIZER") ? "ORGANIZER:https://example.com/user" : line))],
    ["unknown TZID", calendar("REQUEST", requestEvent.map((line) =>
      line.startsWith("DTSTART") ? "DTSTART;TZID=Moon/Base:20260810T090000" : line))],
    ["floating DTSTAMP", calendar("REQUEST", requestEvent.map((line) =>
      line.startsWith("DTSTAMP") ? "DTSTAMP:20260804T101112" : line))],
    ["end and duration", calendar("REQUEST", [...requestEvent, "DURATION:PT1H"])],
    ["unsupported recurrence dates", calendar("REQUEST", [...requestEvent, "EXDATE:20260812T090000"])],
    ["unbounded recurrence", calendar("REQUEST", requestEvent.map((line) =>
      line.startsWith("RRULE") ? "RRULE:FREQ=DAILY;COUNT=10;UNTIL=20261201T000000Z" : line))],
    ["invalid duration", calendar("PUBLISH", [
      "UID:duration", "DTSTAMP:20260804T101112Z", "DTSTART:20260810T090000",
      "DURATION:P1DT", "SUMMARY:Bad duration",
    ])],
  ])("rejects %s", (_label, input) => {
    expect(() => parseCalendarInvitation(input)).toThrow(CalendarParseError);
  });

  it("rejects invalid UTF-8, controls, bidi overrides, and size overflow", () => {
    expect(() => parseCalendarInvitation(Uint8Array.from([0xff, 0xfe])))
      .toThrow(/valid UTF-8/u);
    expect(() => parseCalendarInvitation(calendar("REQUEST", requestEvent)
      .replace("Architecture review", "Architecture\u0000review"))).toThrow(/unsafe/u);
    expect(() => parseCalendarInvitation(calendar("REQUEST", requestEvent)
      .replace("Architecture review", "Architecture\u202ereview"))).toThrow(/unsafe/u);
    expect(() => parseCalendarInvitation("x".repeat(CALENDAR_LIMITS.inputBytes + 1)))
      .toThrow(/too large/u);
  });
});
