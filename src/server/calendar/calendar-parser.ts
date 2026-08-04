import type {
  CalendarInvitation,
  CalendarMethod,
} from "@/domain/mail/calendar";
import { CALENDAR_LIMITS } from "@/server/calendar/calendar-limits";
import { parseCalendarEvent } from "@/server/calendar/calendar-parser-event";
import { unfoldCalendarLines } from "@/server/calendar/calendar-parser-lines";
import {
  type CalendarProperty,
  parseCalendarProperty,
} from "@/server/calendar/calendar-parser-property";
import {
  CalendarParseError,
  assertCalendarText,
  assertIgnoredUriIsSafe,
} from "@/server/calendar/calendar-validation";

const methods = new Set<CalendarMethod>([
  "CANCEL", "PUBLISH", "REPLY", "REQUEST",
]);
const uriProperties = new Set([
  "ATTACH", "CONFERENCE", "IMAGE", "SOURCE", "STRUCTURED-DATA", "TZURL", "URL",
]);

interface ParsedContainer {
  readonly eventProperties: readonly CalendarProperty[];
  readonly rootProperties: readonly CalendarProperty[];
}

const componentName = (property: CalendarProperty): string => {
  if (property.parameters.size > 0 ||
      !/^[A-Za-z][A-Za-z0-9-]{0,63}$/u.test(property.value)) {
    throw new CalendarParseError("Component boundary is malformed.", property.line);
  }
  return property.value.toUpperCase();
};

const allowedNestedComponent = (
  parent: string,
  child: string,
): boolean =>
  (parent === "VCALENDAR" && ["VEVENT", "VTIMEZONE"].includes(child)) ||
  (parent === "VEVENT" && child === "VALARM") ||
  (parent === "VTIMEZONE" && ["DAYLIGHT", "STANDARD"].includes(child));

const parseContainer = (
  input: Uint8Array | string,
): ParsedContainer => {
  const lines = unfoldCalendarLines(input);
  const stack: string[] = [];
  const rootProperties: CalendarProperty[] = [];
  const eventProperties: CalendarProperty[] = [];
  let components = 0;
  let events = 0;
  let properties = 0;
  let closed = false;
  for (const logical of lines) {
    if (!logical.value) {
      throw new CalendarParseError("Blank content lines are not allowed.", logical.number);
    }
    if (closed) {
      throw new CalendarParseError("Content appears after VCALENDAR.", logical.number);
    }
    const property = parseCalendarProperty(logical);
    if (property.name === "BEGIN") {
      const child = componentName(property);
      if (stack.length === 0 && child !== "VCALENDAR") {
        throw new CalendarParseError("Input must begin with VCALENDAR.", property.line);
      }
      if (stack.length > 0 && !allowedNestedComponent(stack.at(-1)!, child)) {
        throw new CalendarParseError(`Unsupported nested ${child} component.`, property.line);
      }
      if (child === "VEVENT") events += 1;
      stack.push(child);
      components += 1;
      if (components > CALENDAR_LIMITS.components ||
          stack.length > CALENDAR_LIMITS.componentDepth) {
        throw new CalendarParseError("Calendar component limits were exceeded.", property.line);
      }
      continue;
    }
    if (property.name === "END") {
      const component = componentName(property);
      if (stack.pop() !== component) {
        throw new CalendarParseError("Component boundaries do not match.", property.line);
      }
      if (stack.length === 0) closed = true;
      continue;
    }
    if (stack.length === 0) {
      throw new CalendarParseError("Property appears outside VCALENDAR.", property.line);
    }
    properties += 1;
    if (properties > CALENDAR_LIMITS.propertiesTotal) {
      throw new CalendarParseError("Calendar has too many properties.", property.line);
    }
    if (uriProperties.has(property.name)) {
      assertIgnoredUriIsSafe(property.value, property.name, property.line);
    }
    if (stack.length === 1 && stack[0] === "VCALENDAR") {
      rootProperties.push(property);
    } else if (stack.length === 2 && stack[1] === "VEVENT") {
      eventProperties.push(property);
    }
  }
  if (!closed || stack.length > 0) {
    throw new CalendarParseError("VCALENDAR is incomplete.");
  }
  if (events !== 1) {
    throw new CalendarParseError("Calendar must contain exactly one primary VEVENT.");
  }
  return { eventProperties, rootProperties };
};

const uniqueRoot = (
  properties: readonly CalendarProperty[],
  name: string,
  required = false,
): CalendarProperty | null => {
  const matches = properties.filter((property) => property.name === name);
  if (matches.length > 1 || (required && matches.length !== 1)) {
    throw new CalendarParseError(
      `VCALENDAR ${name} is ${matches.length > 1 ? "duplicated" : "missing"}.`,
    );
  }
  return matches[0] ?? null;
};

export const parseCalendarInvitation = (
  input: Uint8Array | string,
): CalendarInvitation => {
  const parsed = parseContainer(input);
  const version = uniqueRoot(parsed.rootProperties, "VERSION", true)!;
  if (version.parameters.size > 0 || version.value !== "2.0") {
    throw new CalendarParseError("Only iCalendar VERSION 2.0 is supported.", version.line);
  }
  const methodProperty = uniqueRoot(parsed.rootProperties, "METHOD", true)!;
  const method = methodProperty.value.toUpperCase();
  if (methodProperty.parameters.size > 0 || !methods.has(method as CalendarMethod)) {
    throw new CalendarParseError("Calendar METHOD is unsupported.", methodProperty.line);
  }
  const scale = uniqueRoot(parsed.rootProperties, "CALSCALE");
  if (scale && (scale.parameters.size > 0 || scale.value.toUpperCase() !== "GREGORIAN")) {
    throw new CalendarParseError("Only the Gregorian calendar scale is supported.", scale.line);
  }
  const product = uniqueRoot(parsed.rootProperties, "PRODID");
  if (product && product.parameters.size > 0) {
    throw new CalendarParseError("PRODID parameters are unsupported.", product.line);
  }
  const productId = product
    ? assertCalendarText(product.value, "PRODID", CALENDAR_LIMITS.textBytes, product.line)
    : null;
  return {
    event: parseCalendarEvent(parsed.eventProperties, method as CalendarMethod),
    method: method as CalendarMethod,
    productId,
  };
};

export { CalendarParseError } from "@/server/calendar/calendar-validation";
