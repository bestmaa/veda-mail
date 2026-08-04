import type {
  CalendarEvent,
  CalendarMethod,
  CalendarTemporalValue,
} from "@/domain/mail/calendar";
import { CALENDAR_LIMITS } from "@/server/calendar/calendar-limits";
import { CalendarParseError } from "@/server/calendar/calendar-validation";

const participationStatuses = new Set([
  "ACCEPTED", "DECLINED", "DELEGATED", "NEEDS-ACTION", "TENTATIVE",
]);

export const calendarTemporalZonesEqual = (
  left: CalendarTemporalValue,
  right: CalendarTemporalValue,
): boolean => {
  if (left.kind !== right.kind) return false;
  if (left.kind === "date" || right.kind === "date") return true;
  return left.zone.kind === right.zone.kind &&
    (left.zone.kind !== "iana" ||
      (right.zone.kind === "iana" && left.zone.id === right.zone.id));
};
export const assertSerializableCalendarEvent = (
  event: CalendarEvent,
  method: CalendarMethod,
): void => {
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 0 ||
      event.sequence > 2_147_483_647) {
    throw new CalendarParseError("SEQUENCE is out of range.");
  }
  if (event.endsAt && event.duration) {
    throw new CalendarParseError("Event cannot have both end and duration.");
  }
  if (event.endsAt && !calendarTemporalZonesEqual(event.startsAt, event.endsAt)) {
    throw new CalendarParseError("Event start and end value types or zones differ.");
  }
  if (event.endsAt && event.endsAt.value <= event.startsAt.value) {
    throw new CalendarParseError("Event end must be later than its start.");
  }
  if (event.recurrenceId && event.recurrenceId.kind !== event.startsAt.kind) {
    throw new CalendarParseError("Recurrence identity type differs from start.");
  }
  if (method !== "PUBLISH" && !event.organizer) {
    throw new CalendarParseError(`${method} requires an organizer.`);
  }
  if (method === "REQUEST" && event.attendees.length === 0) {
    throw new CalendarParseError("REQUEST requires an attendee.");
  }
  if (method === "REPLY" && event.attendees.length !== 1) {
    throw new CalendarParseError("REPLY requires exactly one attendee.");
  }
  if (event.attendees.length > CALENDAR_LIMITS.attendeesPerEvent) {
    throw new CalendarParseError("Event has too many attendees.");
  }
  const emails = event.attendees.map(({ email }) => email.toLowerCase());
  if (new Set(emails).size !== emails.length || event.attendees.some(
    ({ participationStatus, rsvp }) =>
      !participationStatuses.has(participationStatus) || typeof rsvp !== "boolean",
  )) {
    throw new CalendarParseError("Event has duplicate or invalid attendees.");
  }
};
