import "server-only";

import type {
  CalendarEvent,
  CalendarTemporalValue,
} from "@/domain/mail/calendar";
import {
  calendarEventIdentity,
  calendarEventSchema,
  compareCalendarEvents,
  type CalendarEventBook,
  MAX_CALENDAR_EVENTS_PER_OWNER,
  parseStoredCalendarEventBook,
  type StoredCalendarEventBook,
} from "@/server/calendar/event-record";
import { ApiError } from "@/transport/http/api-error";

export type CalendarEventPutOperation =
  | {
      readonly event: CalendarEvent;
      readonly expectedRevision: string | null;
      readonly operation: "import-event";
    }
  | {
      readonly expectedRevision: string | null;
      readonly operation: "remove-event";
      readonly recurrenceId: CalendarTemporalValue | null;
      readonly uid: string;
    };

const finalize = (
  current: CalendarEventBook,
  events: readonly CalendarEvent[],
  now: string,
): StoredCalendarEventBook => parseStoredCalendarEventBook({
  createdAt: current.createdAt ?? now,
  events: [...events].sort(compareCalendarEvents),
  revision: crypto.randomUUID(),
  updatedAt: now,
  version: 1,
});

const sameCanonicalEvent = (
  left: CalendarEvent,
  right: CalendarEvent,
): boolean => JSON.stringify(left) === JSON.stringify(right);

export const updateCalendarEventBook = (
  current: CalendarEventBook,
  operation: CalendarEventPutOperation,
  now = new Date().toISOString(),
): CalendarEventBook => {
  if (operation.operation === "remove-event") {
    const identity = calendarEventIdentity(operation);
    const events = current.events.filter(
      (event) => calendarEventIdentity(event) !== identity,
    );
    if (events.length === current.events.length) {
      throw new ApiError(
        "The calendar event was not found.",
        "CALENDAR_EVENT_NOT_FOUND",
        404,
      );
    }
    return finalize(current, events, now);
  }

  const event = calendarEventSchema.parse(operation.event) as CalendarEvent;
  const identity = calendarEventIdentity(event);
  const index = current.events.findIndex(
    (candidate) => calendarEventIdentity(candidate) === identity,
  );
  if (index < 0) {
    if (current.events.length >= MAX_CALENDAR_EVENTS_PER_OWNER) {
      throw new ApiError(
        `Each identity can contain at most ${MAX_CALENDAR_EVENTS_PER_OWNER} calendar events.`,
        "CALENDAR_EVENT_LIMIT_REACHED",
        422,
      );
    }
    return finalize(current, [...current.events, event], now);
  }

  const existing = current.events[index]!;
  if (event.sequence < existing.sequence) return current;
  if (event.sequence === existing.sequence) {
    if (sameCanonicalEvent(existing, event)) return current;
    throw new ApiError(
      "This event sequence conflicts with an existing calendar event.",
      "CALENDAR_EVENT_SEQUENCE_CONFLICT",
      409,
    );
  }
  const events = [...current.events];
  events[index] = event;
  return finalize(current, events, now);
};
