import type { CalendarRecurrenceRule } from "@/domain/mail/calendar";
import { CALENDAR_LIMITS } from "@/server/calendar/calendar-limits";
import type { CalendarProperty } from "@/server/calendar/calendar-parser-property";
import { CalendarParseError } from "@/server/calendar/calendar-validation";

const frequencies = new Set([
  "SECONDLY", "MINUTELY", "HOURLY", "DAILY", "WEEKLY", "MONTHLY", "YEARLY",
]);
const weekdays = new Set(["MO", "TU", "WE", "TH", "FR", "SA", "SU"]);
const order = [
  "FREQ", "INTERVAL", "COUNT", "UNTIL", "BYSECOND", "BYMINUTE", "BYHOUR",
  "BYDAY", "BYMONTHDAY", "BYYEARDAY", "BYWEEKNO", "BYMONTH", "BYSETPOS", "WKST",
] as const;

const integer = (
  value: string,
  minimum: number,
  maximum: number,
  allowZero = true,
): boolean => {
  if (!/^-?(?:0|[1-9]\d*)$/u.test(value)) return false;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum &&
    (allowZero || parsed !== 0);
};

const numberList = (
  value: string,
  minimum: number,
  maximum: number,
  allowZero = true,
): boolean => {
  const values = value.split(",");
  return values.length <= CALENDAR_LIMITS.recurrenceValues &&
    new Set(values).size === values.length &&
    values.every((item) => integer(item, minimum, maximum, allowZero));
};

const validUntil = (value: string): boolean => {
  const match = value.match(
    /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z)?$/u,
  );
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3]) &&
    (!match[4] || (Number(match[4]) <= 23 && Number(match[5]) <= 59 &&
      Number(match[6]) <= 59));
};

const validByDay = (value: string): boolean => {
  const values = value.split(",");
  return values.length <= CALENDAR_LIMITS.recurrenceValues &&
    new Set(values).size === values.length && values.every((item) => {
    const match = item.match(/^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/u);
    return Boolean(match) && (!match?.[1] || integer(match[1], -53, 53, false));
  });
};

const validPart = (name: string, value: string): boolean => {
  if (name === "FREQ") return frequencies.has(value);
  if (name === "INTERVAL") return integer(value, 1, 10_000);
  if (name === "COUNT") return integer(value, 1, 100_000);
  if (name === "UNTIL") return validUntil(value);
  if (name === "BYSECOND") return numberList(value, 0, 60);
  if (name === "BYMINUTE") return numberList(value, 0, 59);
  if (name === "BYHOUR") return numberList(value, 0, 23);
  if (name === "BYDAY") return validByDay(value);
  if (name === "BYMONTHDAY") return numberList(value, -31, 31, false);
  if (name === "BYYEARDAY") return numberList(value, -366, 366, false);
  if (name === "BYWEEKNO") return numberList(value, -53, 53, false);
  if (name === "BYMONTH") return numberList(value, 1, 12);
  if (name === "BYSETPOS") return numberList(value, -366, 366, false);
  return name === "WKST" && weekdays.has(value);
};

export const parseCalendarRecurrence = (
  property: CalendarProperty,
): CalendarRecurrenceRule => {
  if (property.parameters.size > 0) {
    throw new CalendarParseError("RRULE parameters are unsupported.", property.line);
  }
  const values = new Map<string, string>();
  const parts = property.value.toUpperCase().split(";");
  if (parts.length > CALENDAR_LIMITS.recurrenceParts) {
    throw new CalendarParseError("RRULE has too many parts.", property.line);
  }
  for (const part of parts) {
    const equals = part.indexOf("=");
    const name = part.slice(0, equals);
    const value = part.slice(equals + 1);
    if (equals < 1 || !order.includes(name as (typeof order)[number]) ||
        values.has(name) || !validPart(name, value)) {
      throw new CalendarParseError("RRULE is malformed or unsupported.", property.line);
    }
    values.set(name, value);
  }
  if (!values.has("FREQ") || (values.has("COUNT") && values.has("UNTIL"))) {
    throw new CalendarParseError("RRULE needs FREQ and one bounded ending.", property.line);
  }
  const canonical = order.flatMap((name) => {
    const value = values.get(name);
    return value ? [`${name}=${value}`] : [];
  }).join(";");
  const frequencyNames: Readonly<Record<string, string>> = {
    DAILY: "day", HOURLY: "hour", MINUTELY: "minute", MONTHLY: "month",
    SECONDLY: "second", WEEKLY: "week", YEARLY: "year",
  };
  const frequency = frequencyNames[values.get("FREQ")!]!;
  const interval = values.get("INTERVAL") ?? "1";
  const details = [
    `Every ${interval === "1" ? "" : `${interval} `}${frequency}`,
    values.get("COUNT") ? `${values.get("COUNT")} occurrences` : null,
    values.get("UNTIL") ? `until ${values.get("UNTIL")}` : null,
    values.get("BYDAY") ? `on ${values.get("BYDAY")}` : null,
  ].filter(Boolean);
  return { canonical, summary: details.join("; ") };
};
