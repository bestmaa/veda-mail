import type {
  CalendarAttendee,
  CalendarEvent,
  CalendarMethod,
  CalendarOrganizer,
  CalendarParticipationStatus,
} from "@/domain/mail/calendar";
import { CALENDAR_LIMITS } from "@/server/calendar/calendar-limits";
import { parseCalendarRecurrence } from "@/server/calendar/calendar-parser-recurrence";
import {
  type CalendarProperty,
  oneCalendarParameter,
} from "@/server/calendar/calendar-parser-property";
import {
  parseCalendarDtstamp,
  parseCalendarDuration,
  parseCalendarTemporal,
} from "@/server/calendar/calendar-parser-temporal";
import {
  CalendarParseError,
  assertCalendarEmail,
  assertCalendarText,
  assertIgnoredUriIsSafe,
  decodeCalendarText,
} from "@/server/calendar/calendar-validation";
import { calendarTemporalZonesEqual } from "@/server/calendar/calendar-validation-event";

const partStats = new Set<CalendarParticipationStatus>([
  "ACCEPTED", "DECLINED", "DELEGATED", "NEEDS-ACTION", "TENTATIVE",
]);
const critical = new Set([
  "DESCRIPTION", "DTEND", "DTSTAMP", "DTSTART", "DURATION", "LOCATION",
  "ORGANIZER", "RECURRENCE-ID", "RRULE", "SEQUENCE", "SUMMARY", "UID",
]);

const one = (
  properties: readonly CalendarProperty[],
  name: string,
): CalendarProperty | null => properties.find((item) => item.name === name) ?? null;

const onlyParameters = (
  property: CalendarProperty,
  allowed: readonly string[],
): void => {
  const accepted = new Set(allowed);
  const unsupported = [...property.parameters.keys()].find(
    (name) => !accepted.has(name) && !name.startsWith("X-"),
  );
  if (unsupported) {
    throw new CalendarParseError(
      `${property.name} parameter ${unsupported} is unsupported.`, property.line,
    );
  }
};

const text = (
  property: CalendarProperty | null,
  maximumBytes: number,
): string | null => {
  if (!property) return null;
  onlyParameters(property, ["ALTREP", "CHARSET", "LANGUAGE"]);
  const alt = oneCalendarParameter(property, "ALTREP");
  if (alt) assertIgnoredUriIsSafe(alt, "ALTREP", property.line);
  const value = decodeCalendarText(
    property.value, property.name, maximumBytes, property.line, true,
  );
  return value || null;
};

const person = (
  property: CalendarProperty,
  extraParameters: readonly string[] = [],
): CalendarOrganizer => {
  onlyParameters(property, [
    "CN", "CUTYPE", "LANGUAGE", "ROLE", "SENT-BY", ...extraParameters,
  ]);
  const sentBy = oneCalendarParameter(property, "SENT-BY");
  if (sentBy) assertCalendarEmail(sentBy, "SENT-BY", property.line);
  const name = oneCalendarParameter(property, "CN");
  if (name?.includes("\n")) {
    throw new CalendarParseError(`${property.name} name must be one line.`, property.line);
  }
  return {
    email: assertCalendarEmail(property.value, property.name, property.line),
    name: name
      ? assertCalendarText(name, `${property.name} name`, CALENDAR_LIMITS.textBytes, property.line)
      : null,
  };
};

const attendee = (property: CalendarProperty): CalendarAttendee => {
  const base = person(property, ["PARTSTAT", "RSVP"]);
  const rawStatus = oneCalendarParameter(property, "PARTSTAT")?.toUpperCase() ??
    "NEEDS-ACTION";
  if (!partStats.has(rawStatus as CalendarParticipationStatus)) {
    throw new CalendarParseError("ATTENDEE PARTSTAT is unsupported.", property.line);
  }
  const rawRsvp = oneCalendarParameter(property, "RSVP")?.toUpperCase();
  if (rawRsvp && rawRsvp !== "TRUE" && rawRsvp !== "FALSE") {
    throw new CalendarParseError("ATTENDEE RSVP must be TRUE or FALSE.", property.line);
  }
  return {
    ...base,
    participationStatus: rawStatus as CalendarParticipationStatus,
    rsvp: rawRsvp === "TRUE",
  };
};

const sequence = (property: CalendarProperty | null): number => {
  if (!property) return 0;
  onlyParameters(property, []);
  if (!/^(?:0|[1-9]\d{0,9})$/u.test(property.value)) {
    throw new CalendarParseError("SEQUENCE is invalid.", property.line);
  }
  const value = Number(property.value);
  if (!Number.isSafeInteger(value) || value > 2_147_483_647) {
    throw new CalendarParseError("SEQUENCE is out of range.", property.line);
  }
  return value;
};

export const parseCalendarEvent = (
  properties: readonly CalendarProperty[],
  method: CalendarMethod,
): CalendarEvent => {
  if (properties.length > CALENDAR_LIMITS.propertiesPerEvent) {
    throw new CalendarParseError("VEVENT has too many properties.");
  }
  for (const name of critical) {
    if (properties.filter((property) => property.name === name).length > 1) {
      throw new CalendarParseError(`VEVENT has duplicate ${name}.`);
    }
  }
  if (properties.some(({ name }) => name === "RDATE" || name === "EXDATE")) {
    throw new CalendarParseError("RDATE and EXDATE are not supported yet.");
  }
  const uidProperty = one(properties, "UID");
  const stampProperty = one(properties, "DTSTAMP");
  const startProperty = one(properties, "DTSTART");
  if (!uidProperty || !stampProperty || !startProperty) {
    throw new CalendarParseError("VEVENT requires UID, DTSTAMP, and DTSTART.");
  }
  onlyParameters(uidProperty, []);
  onlyParameters(stampProperty, ["VALUE"]);
  onlyParameters(startProperty, ["TZID", "VALUE"]);
  const startsAt = parseCalendarTemporal(startProperty);
  const endProperty = one(properties, "DTEND");
  const durationProperty = one(properties, "DURATION");
  if (endProperty && durationProperty) {
    throw new CalendarParseError("VEVENT cannot contain both DTEND and DURATION.");
  }
  if (endProperty) onlyParameters(endProperty, ["TZID", "VALUE"]);
  const endsAt = endProperty ? parseCalendarTemporal(endProperty) : null;
  if (endsAt && endsAt.kind !== startsAt.kind) {
    throw new CalendarParseError("DTSTART and DTEND value types must match.");
  }
  if (endsAt && calendarTemporalZonesEqual(endsAt, startsAt) &&
      endsAt.value <= startsAt.value) {
    throw new CalendarParseError("DTEND must be later than DTSTART.");
  }
  if (durationProperty) onlyParameters(durationProperty, []);
  const duration = durationProperty ? parseCalendarDuration(durationProperty) : null;
  if (duration && startsAt.kind === "date" && duration.includes("T")) {
    throw new CalendarParseError("An all-day event duration cannot contain time.");
  }
  const recurrenceProperty = one(properties, "RECURRENCE-ID");
  if (recurrenceProperty) onlyParameters(recurrenceProperty, ["RANGE", "TZID", "VALUE"]);
  if (recurrenceProperty && oneCalendarParameter(recurrenceProperty, "RANGE")) {
    throw new CalendarParseError("RECURRENCE-ID RANGE is unsupported.");
  }
  const recurrenceId = recurrenceProperty
    ? parseCalendarTemporal(recurrenceProperty) : null;
  if (recurrenceId && recurrenceId.kind !== startsAt.kind) {
    throw new CalendarParseError("RECURRENCE-ID and DTSTART types must match.");
  }
  const organizerProperty = one(properties, "ORGANIZER");
  const organizer = organizerProperty ? person(organizerProperty) : null;
  const attendees = properties.filter(({ name }) => name === "ATTENDEE").map(attendee);
  if (attendees.length > CALENDAR_LIMITS.attendeesPerEvent ||
      new Set(attendees.map(({ email }) => email.toLowerCase())).size !== attendees.length) {
    throw new CalendarParseError("VEVENT has too many or duplicate attendees.");
  }
  if (method !== "PUBLISH" && !organizer) {
    throw new CalendarParseError(`${method} requires ORGANIZER.`);
  }
  if (method === "REQUEST" && attendees.length === 0) {
    throw new CalendarParseError("REQUEST requires at least one ATTENDEE.");
  }
  if (method === "REPLY" && attendees.length !== 1) {
    throw new CalendarParseError("REPLY requires exactly one ATTENDEE.");
  }
  const rrule = one(properties, "RRULE");
  const uid = decodeCalendarText(
    uidProperty.value, "UID", CALENDAR_LIMITS.uidBytes, uidProperty.line, false,
  );
  if (uid.includes("\n")) {
    throw new CalendarParseError("UID must be one line.", uidProperty.line);
  }
  return {
    attendees,
    description: text(one(properties, "DESCRIPTION"), CALENDAR_LIMITS.descriptionBytes),
    dtstamp: parseCalendarDtstamp(stampProperty),
    duration,
    endsAt,
    location: text(one(properties, "LOCATION"), CALENDAR_LIMITS.textBytes),
    organizer,
    recurrenceId,
    recurrenceRule: rrule ? parseCalendarRecurrence(rrule) : null,
    sequence: sequence(one(properties, "SEQUENCE")),
    startsAt,
    summary: text(one(properties, "SUMMARY"), CALENDAR_LIMITS.summaryBytes) ?? "",
    uid,
  };
};
