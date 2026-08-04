import type { CalendarTemporalValue } from "@/domain/mail/calendar";
import type { CalendarProperty } from "@/server/calendar/calendar-parser-property";
import { oneCalendarParameter } from "@/server/calendar/calendar-parser-property";
import {
  CalendarParseError,
  isRecognizedIanaTimeZone,
} from "@/server/calendar/calendar-validation";

const validDate = (year: number, month: number, day: number): boolean => {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

const dateValue = (
  value: string,
  line: number,
): CalendarTemporalValue => {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})$/u);
  if (!match || !validDate(Number(match[1]), Number(match[2]), Number(match[3]))) {
    throw new CalendarParseError("Calendar date is invalid.", line);
  }
  return {
    kind: "date",
    value: `${match[1]}-${match[2]}-${match[3]}`,
  };
};

const dateTimeValue = (
  property: CalendarProperty,
): CalendarTemporalValue => {
  const match = property.value.match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/u,
  );
  if (
    !match || !validDate(Number(match[1]), Number(match[2]), Number(match[3])) ||
    Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59
  ) {
    throw new CalendarParseError("Calendar date-time is invalid.", property.line);
  }
  const tzid = oneCalendarParameter(property, "TZID");
  if (match[7] && tzid) {
    throw new CalendarParseError("UTC date-time cannot also have TZID.", property.line);
  }
  if (tzid && !isRecognizedIanaTimeZone(tzid)) {
    throw new CalendarParseError("TZID is not a recognized IANA time zone.", property.line);
  }
  return {
    kind: "date-time",
    value: `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`,
    zone: match[7]
      ? { kind: "utc" }
      : tzid
        ? { id: tzid, kind: "iana" }
        : { kind: "floating" },
  };
};

export const parseCalendarTemporal = (
  property: CalendarProperty,
): CalendarTemporalValue => {
  const valueType = oneCalendarParameter(property, "VALUE")?.toUpperCase();
  const inferredDate = /^\d{8}$/u.test(property.value);
  if (valueType && !["DATE", "DATE-TIME"].includes(valueType)) {
    throw new CalendarParseError("Temporal VALUE type is unsupported.", property.line);
  }
  if (valueType === "DATE" || (!valueType && inferredDate)) {
    if (property.parameters.has("TZID")) {
      throw new CalendarParseError("A DATE cannot have TZID.", property.line);
    }
    return dateValue(property.value, property.line);
  }
  return dateTimeValue(property);
};

export const parseCalendarDtstamp = (
  property: CalendarProperty,
): CalendarTemporalValue => {
  const value = parseCalendarTemporal(property);
  if (value.kind !== "date-time" || value.zone.kind !== "utc") {
    throw new CalendarParseError("DTSTAMP must be a UTC date-time.", property.line);
  }
  return value;
};

export const parseCalendarDuration = (property: CalendarProperty): string => {
  const value = property.value.toUpperCase();
  if (
    value.length > 64 ||
    !/^P(?:[1-9]\d*W|(?:(?:[1-9]\d*)D)?(?:T(?:(?:[1-9]\d*)H)?(?:(?:[1-9]\d*)M)?(?:(?:[1-9]\d*)S)?)?)$/u.test(value) ||
    value === "P" || value === "PT" || value.endsWith("T")
  ) {
    throw new CalendarParseError("Event duration is invalid or non-positive.", property.line);
  }
  return value;
};
