import type {
  CalendarAttendee,
  CalendarEvent,
  CalendarInvitation,
  CalendarMethod,
  CalendarReplyInput,
  CalendarTemporalValue,
} from "@/domain/mail/calendar";
import {
  CALENDAR_LIMITS,
  CALENDAR_PRODUCT_ID,
} from "@/server/calendar/calendar-limits";
import { parseCalendarInvitation } from "@/server/calendar/calendar-parser";
import type { CalendarProperty } from "@/server/calendar/calendar-parser-property";
import {
  parseCalendarDtstamp,
  parseCalendarDuration,
  parseCalendarTemporal,
} from "@/server/calendar/calendar-parser-temporal";
import { parseCalendarRecurrence } from "@/server/calendar/calendar-parser-recurrence";
import {
  assertCalendarSerializedSize,
  encodeCalendarParameter,
  escapeCalendarText,
  serializeCalendarLines,
} from "@/server/calendar/calendar-serializer-lines";
import {
  CalendarParseError,
  assertCalendarEmail,
} from "@/server/calendar/calendar-validation";
import { assertSerializableCalendarEvent } from "@/server/calendar/calendar-validation-event";

const property = (
  name: string,
  value: string,
  parameters: ReadonlyMap<string, readonly string[]> = new Map(),
): CalendarProperty => ({ line: 0, name, parameters, value });

const compactTemporal = (value: CalendarTemporalValue): string =>
  value.value.replaceAll("-", "").replaceAll(":", "");

const temporalLine = (
  name: string,
  value: CalendarTemporalValue,
  stamp = false,
): string => {
  const compact = compactTemporal(value);
  let line: string;
  let parameters = new Map<string, readonly string[]>();
  if (value.kind === "date") {
    parameters = new Map([["VALUE", ["DATE"]]]);
    line = `${name};VALUE=DATE:${compact}`;
  } else if (value.zone.kind === "utc") {
    line = `${name}:${compact}Z`;
  } else if (value.zone.kind === "iana") {
    parameters = new Map([["TZID", [value.zone.id]]]);
    line = `${name};TZID=${value.zone.id}:${compact}`;
  } else line = `${name}:${compact}`;
  const parsed = stamp
    ? parseCalendarDtstamp(property(name, line.slice(line.indexOf(":") + 1), parameters))
    : parseCalendarTemporal(property(
        name,
        value.kind === "date-time" && value.zone.kind === "utc" ? `${compact}Z` : compact,
        parameters,
      ));
  if (JSON.stringify(parsed) !== JSON.stringify(value)) {
    throw new CalendarParseError(`${name} is not canonical.`);
  }
  return line;
};

const personLine = (
  name: "ATTENDEE" | "ORGANIZER",
  person: Pick<CalendarAttendee, "email" | "name">,
  attendee?: Pick<CalendarAttendee, "participationStatus" | "rsvp">,
): string => {
  const email = assertCalendarEmail(`mailto:${person.email}`, name);
  const parameters = [
    ...(person.name
      ? [`CN=${encodeCalendarParameter(person.name, `${name} name`)}`]
      : []),
    ...(attendee
      ? [
          `PARTSTAT=${attendee.participationStatus}`,
          `RSVP=${attendee.rsvp ? "TRUE" : "FALSE"}`,
        ]
      : []),
  ];
  return `${name}${parameters.length ? `;${parameters.join(";")}` : ""}:mailto:${email}`;
};

const eventIdentity = (event: CalendarEvent): string =>
  `${event.uid}\0${event.recurrenceId ? JSON.stringify(event.recurrenceId) : ""}`;

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const eventLines = (
  event: CalendarEvent,
  method: CalendarMethod,
): readonly string[] => {
  assertSerializableCalendarEvent(event, method);
  const uid = escapeCalendarText(
    event.uid, "UID", CALENDAR_LIMITS.uidBytes, false,
  );
  const lines = [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    temporalLine("DTSTAMP", event.dtstamp, true),
    `SEQUENCE:${event.sequence}`,
    temporalLine("DTSTART", event.startsAt),
  ];
  if (event.endsAt) lines.push(temporalLine("DTEND", event.endsAt));
  if (event.duration) {
    lines.push(`DURATION:${parseCalendarDuration(property("DURATION", event.duration))}`);
  }
  if (event.recurrenceId) lines.push(temporalLine("RECURRENCE-ID", event.recurrenceId));
  if (event.recurrenceRule) {
    const rule = parseCalendarRecurrence(property("RRULE", event.recurrenceRule.canonical));
    if (rule.canonical !== event.recurrenceRule.canonical) {
      throw new CalendarParseError("RRULE is not canonical.");
    }
    lines.push(`RRULE:${rule.canonical}`);
  }
  lines.push(`SUMMARY:${escapeCalendarText(
    event.summary, "SUMMARY", CALENDAR_LIMITS.summaryBytes,
  )}`);
  if (event.description !== null) lines.push(`DESCRIPTION:${escapeCalendarText(
    event.description, "DESCRIPTION", CALENDAR_LIMITS.descriptionBytes,
  )}`);
  if (event.location !== null) lines.push(`LOCATION:${escapeCalendarText(
    event.location, "LOCATION", CALENDAR_LIMITS.textBytes,
  )}`);
  if (event.organizer) lines.push(personLine("ORGANIZER", event.organizer));
  for (const attendee of [...event.attendees].sort((left, right) =>
    compareText(left.email.toLowerCase(), right.email.toLowerCase()))) {
    lines.push(personLine("ATTENDEE", attendee, attendee));
  }
  lines.push("END:VEVENT");
  return lines;
};

const calendarLines = (
  method: CalendarMethod,
  events: readonly CalendarEvent[],
): readonly string[] => [
  "BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:${CALENDAR_PRODUCT_ID}`,
  "CALSCALE:GREGORIAN", `METHOD:${method}`,
  ...events.flatMap((event) => eventLines(event, method)), "END:VCALENDAR",
];

export const serializeCalendarEvent = (
  invitation: CalendarInvitation,
): string => {
  const output = serializeCalendarLines(calendarLines(
    invitation.method, [invitation.event],
  ));
  parseCalendarInvitation(output);
  return output;
};

export const serializeCalendarEvents = (
  events: readonly CalendarEvent[],
): string => {
  if (events.length > CALENDAR_LIMITS.eventsPerExport) {
    throw new CalendarParseError("Calendar export has too many events.");
  }
  const sorted = [...events].sort((left, right) =>
    compareText(eventIdentity(left), eventIdentity(right)));
  const identities = sorted.map(eventIdentity);
  if (new Set(identities).size !== identities.length) {
    throw new CalendarParseError("Calendar export has duplicate event identities.");
  }
  return assertCalendarSerializedSize(
    serializeCalendarLines(calendarLines("PUBLISH", sorted)),
    CALENDAR_LIMITS.exportBytes,
  );
};

export const serializeCalendarReply = (input: CalendarReplyInput): string => {
  if (input.invitation.method !== "REQUEST" || !input.invitation.event.organizer) {
    throw new CalendarParseError("Only a REQUEST with an organizer can be answered.");
  }
  const matches = input.invitation.event.attendees.filter(
    ({ email }) => email.toLowerCase() === input.attendeeEmail.toLowerCase(),
  );
  if (matches.length !== 1) {
    throw new CalendarParseError("Reply attendee is not uniquely invited.");
  }
  const respondedAt = input.respondedAt ?? new Date();
  if (Number.isNaN(respondedAt.getTime())) {
    throw new CalendarParseError("Reply timestamp is invalid.");
  }
  const stamp = respondedAt.toISOString().slice(0, 19);
  return serializeCalendarEvent({
    method: "REPLY",
    productId: CALENDAR_PRODUCT_ID,
    event: {
      ...input.invitation.event,
      attendees: [{
        ...matches[0]!,
        participationStatus: input.participationStatus,
        rsvp: false,
      }],
      dtstamp: { kind: "date-time", value: stamp, zone: { kind: "utc" } },
    },
  });
};
