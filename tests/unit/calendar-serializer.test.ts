import { describe, expect, it } from "vitest";

import type {
  CalendarEvent,
  CalendarInvitation,
} from "@/domain/mail/calendar";
import { parseCalendarInvitation } from "@/server/calendar/calendar-parser";
import {
  serializeCalendarEvent,
  serializeCalendarEvents,
  serializeCalendarReply,
} from "@/server/calendar/calendar-serializer";

const event = (uid = "event-1@example.com"): CalendarEvent => ({
  attendees: [{
    email: "member@example.net",
    name: "Member, One",
    participationStatus: "NEEDS-ACTION",
    rsvp: true,
  }],
  description: "Agenda; review\nBring notes",
  dtstamp: {
    kind: "date-time",
    value: "2026-08-04T10:11:12",
    zone: { kind: "utc" },
  },
  duration: null,
  endsAt: {
    kind: "date-time",
    value: "2026-08-10T10:00:00",
    zone: { id: "Asia/Calcutta", kind: "iana" },
  },
  location: "Room 4, North",
  organizer: { email: "organizer@example.com", name: "Organizer" },
  recurrenceId: null,
  recurrenceRule: {
    canonical: "FREQ=WEEKLY;INTERVAL=1;COUNT=3;BYDAY=MO",
    summary: "Every week; 3 occurrences; on MO",
  },
  sequence: 3,
  startsAt: {
    kind: "date-time",
    value: "2026-08-10T09:00:00",
    zone: { id: "Asia/Calcutta", kind: "iana" },
  },
  summary: "A deliberately long Unicode meeting title 🗓️ ".repeat(3).trim(),
  uid,
});

const invitation: CalendarInvitation = {
  event: event(),
  method: "REQUEST",
  productId: "ignored-untrusted-product",
};

describe("canonical iCalendar serializer", () => {
  it("emits deterministic folded CRLF content that round-trips", () => {
    const first = serializeCalendarEvent(invitation);
    const second = serializeCalendarEvent(invitation);

    expect(first).toBe(second);
    expect(first).toMatch(/^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/u);
    expect(first).toContain("\r\n ");
    expect(first).toMatch(/DESCRIPTION:Agenda\\; review\\nBring notes\r\n/u);
    expect(first).toContain("LOCATION:Room 4\\, North\r\n");
    expect(first).toContain("METHOD:REQUEST\r\n");
    expect(first.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(first.replaceAll("\r\n", "")).not.toContain("\n");
    expect(parseCalendarInvitation(first).event).toEqual(invitation.event);
  });

  it("serializes a deterministic whole-book VCALENDAR, including empty books", () => {
    const exported = serializeCalendarEvents([event("z@example.com"), event("a@example.com")]);
    const empty = serializeCalendarEvents([]);

    expect(exported.match(/BEGIN:VCALENDAR/gu)).toHaveLength(1);
    expect(exported.match(/BEGIN:VEVENT/gu)).toHaveLength(2);
    expect(exported.indexOf("UID:a@example.com")).toBeLessThan(
      exported.indexOf("UID:z@example.com"),
    );
    expect(empty).toBe(
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n" +
      "PRODID:-//Veda Concepts//Veda Mail//EN\r\n" +
      "CALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nEND:VCALENDAR\r\n",
    );
  });

  it("emits a canonical METHOD:REPLY for the exact invited attendee", () => {
    const reply = serializeCalendarReply({
      attendeeEmail: "MEMBER@example.net",
      invitation,
      participationStatus: "TENTATIVE",
      respondedAt: new Date("2026-08-05T12:34:56.789Z"),
    });
    const parsed = parseCalendarInvitation(reply);

    expect(parsed.method).toBe("REPLY");
    expect(parsed.event.uid).toBe(invitation.event.uid);
    expect(parsed.event.sequence).toBe(3);
    expect(parsed.event.dtstamp).toEqual({
      kind: "date-time",
      value: "2026-08-05T12:34:56",
      zone: { kind: "utc" },
    });
    expect(parsed.event.attendees).toEqual([{
      email: "member@example.net",
      name: "Member, One",
      participationStatus: "TENTATIVE",
      rsvp: false,
    }]);
    expect(reply).toContain("METHOD:REPLY\r\n");
    expect(reply.replaceAll("\r\n ", "")).toContain(
      "PARTSTAT=TENTATIVE;RSVP=FALSE:mailto:member@example.net",
    );
  });

  it("rejects unsafe/noncanonical output and ambiguous replies", () => {
    expect(() => serializeCalendarEvent({
      ...invitation,
      event: { ...invitation.event, summary: "unsafe\u202etitle" },
    })).toThrow(/unsafe/u);
    expect(() => serializeCalendarEvents([event(), event()])).toThrow(/duplicate/u);
    expect(() => serializeCalendarReply({
      attendeeEmail: "other@example.net",
      invitation,
      participationStatus: "ACCEPTED",
    })).toThrow(/not uniquely invited/u);
    expect(() => serializeCalendarReply({
      attendeeEmail: "member@example.net",
      invitation: { ...invitation, method: "PUBLISH" },
      participationStatus: "ACCEPTED",
    })).toThrow(/Only a REQUEST/u);
  });
});
