import { describe, expect, it } from "vitest";

import type { CalendarEvent } from "@/domain/mail/calendar";
import { updateCalendarEventBook } from "@/server/calendar/event-book";
import { emptyCalendarEventBook } from "@/server/calendar/event-record";

const instant = (value: string) => ({
  kind: "date-time" as const,
  value,
  zone: { kind: "utc" as const },
});

const event = (
  overrides: Partial<CalendarEvent> = {},
): CalendarEvent => ({
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
  ...overrides,
});

const importEvent = (
  value: CalendarEvent,
  expectedRevision: string | null,
) => ({
  event: value,
  expectedRevision,
  operation: "import-event" as const,
});

describe("calendar event book", () => {
  it("upserts identities without downgrading a higher sequence", () => {
    const first = updateCalendarEventBook(
      emptyCalendarEventBook(),
      importEvent(event({ sequence: 2 }), null),
      "2026-08-04T08:00:00.000Z",
    );
    const lower = updateCalendarEventBook(
      first,
      importEvent(event({ sequence: 1, summary: "Stale" }), first.revision),
    );
    expect(lower).toBe(first);
    const higher = updateCalendarEventBook(
      first,
      importEvent(event({ sequence: 3, summary: "Updated" }), first.revision),
      "2026-08-04T09:00:00.000Z",
    );
    expect(higher.events).toEqual([
      expect.objectContaining({ sequence: 3, summary: "Updated" }),
    ]);
  });

  it("rejects conflicting content at the same sequence", () => {
    const first = updateCalendarEventBook(
      emptyCalendarEventBook(),
      importEvent(event(), null),
    );
    expect(() => updateCalendarEventBook(
      first,
      importEvent(event({ summary: "Conflict" }), first.revision),
    )).toThrow(expect.objectContaining({
      code: "CALENDAR_EVENT_SEQUENCE_CONFLICT",
    }));
  });

  it("keeps recurrence instances distinct and removes an exact identity", () => {
    const master = updateCalendarEventBook(
      emptyCalendarEventBook(),
      importEvent(event(), null),
    );
    const recurrenceId = instant("2026-08-12T08:00:00");
    const withInstance = updateCalendarEventBook(
      master,
      importEvent(event({ recurrenceId, summary: "Instance" }), master.revision),
    );
    expect(withInstance.events).toHaveLength(2);
    const removed = updateCalendarEventBook(withInstance, {
      expectedRevision: withInstance.revision,
      operation: "remove-event",
      recurrenceId,
      uid: "event-1@example.com",
    });
    expect(removed.events).toEqual([
      expect.objectContaining({ recurrenceId: null, summary: "Planning" }),
    ]);
  });
});
