import { CALENDAR_LIMITS } from "@/server/calendar/calendar-limits";
import type { CalendarLogicalLine } from "@/server/calendar/calendar-parser-lines";
import {
  CalendarParseError,
  calendarUtf8Bytes,
  decodeCalendarParameter,
} from "@/server/calendar/calendar-validation";

export interface CalendarProperty {
  readonly line: number;
  readonly name: string;
  readonly parameters: ReadonlyMap<string, readonly string[]>;
  readonly value: string;
}

const splitOutsideQuotes = (value: string, separator: string): string[] => {
  const output: string[] = [];
  let quoted = false;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '"') quoted = !quoted;
    else if (!quoted && value[index] === separator) {
      output.push(value.slice(start, index));
      start = index + 1;
    }
  }
  if (quoted) throw new CalendarParseError("Content line has an open quote.");
  output.push(value.slice(start));
  return output;
};

const separatorIndex = (value: string, separator: string): number => {
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '"') quoted = !quoted;
    else if (!quoted && value[index] === separator) return index;
  }
  return -1;
};

const parameterValues = (
  raw: string,
  name: string,
  line: number,
): readonly string[] => {
  const values = splitOutsideQuotes(raw, ",");
  if (values.length === 0 || values.some((value) => value.length === 0)) {
    throw new CalendarParseError(`${name} parameter is empty.`, line);
  }
  return values.map((value) => {
    const quoted = value.startsWith('"') && value.endsWith('"');
    if (value.includes('"') && !quoted) {
      throw new CalendarParseError(`${name} parameter has invalid quoting.`, line);
    }
    const unquoted = quoted ? value.slice(1, -1) : value;
    if (calendarUtf8Bytes(unquoted) > CALENDAR_LIMITS.parameterBytes) {
      throw new CalendarParseError(`${name} parameter is too long.`, line);
    }
    return decodeCalendarParameter(unquoted, `${name} parameter`, line);
  });
};

export const parseCalendarProperty = (
  logical: CalendarLogicalLine,
): CalendarProperty => {
  const colon = separatorIndex(logical.value, ":");
  if (colon < 1) {
    throw new CalendarParseError("Content line is malformed.", logical.number);
  }
  const sections = splitOutsideQuotes(logical.value.slice(0, colon), ";");
  const rawName = sections.shift()!;
  if (!/^(?:[A-Za-z][A-Za-z0-9-]{0,63}\.)?[A-Za-z][A-Za-z0-9-]{0,63}$/u.test(rawName)) {
    throw new CalendarParseError("Property or group name is invalid.", logical.number);
  }
  const name = rawName.includes(".") ? rawName.slice(rawName.lastIndexOf(".") + 1) : rawName;
  if (!/^[A-Za-z][A-Za-z0-9-]{0,63}$/u.test(name)) {
    throw new CalendarParseError("Property name is invalid.", logical.number);
  }
  if (sections.length > CALENDAR_LIMITS.parametersPerProperty) {
    throw new CalendarParseError("Property has too many parameters.", logical.number);
  }
  const parameters = new Map<string, readonly string[]>();
  for (const section of sections) {
    const equals = section.indexOf("=");
    if (equals < 1) {
      throw new CalendarParseError("Property parameter is malformed.", logical.number);
    }
    const key = section.slice(0, equals).toUpperCase();
    if (!/^[A-Z][A-Z0-9-]{0,63}$/u.test(key) || parameters.has(key)) {
      throw new CalendarParseError("Property parameter is invalid or duplicated.", logical.number);
    }
    parameters.set(
      key,
      parameterValues(section.slice(equals + 1), key, logical.number),
    );
  }
  if (parameters.has("ENCODING")) {
    throw new CalendarParseError("Transfer encodings are not supported.", logical.number);
  }
  if (parameters.get("VALUE")?.some((value) => value.toUpperCase() === "BINARY")) {
    throw new CalendarParseError("Binary property values are not supported.", logical.number);
  }
  const charset = parameters.get("CHARSET");
  if (charset && (charset.length !== 1 || charset[0]!.toUpperCase() !== "UTF-8")) {
    throw new CalendarParseError("Only UTF-8 calendar text is supported.", logical.number);
  }
  return {
    line: logical.number,
    name: name.toUpperCase(),
    parameters,
    value: logical.value.slice(colon + 1),
  };
};

export const oneCalendarParameter = (
  property: CalendarProperty,
  name: string,
): string | null => {
  const values = property.parameters.get(name);
  if (!values) return null;
  if (values.length !== 1) {
    throw new CalendarParseError(`${name} must have one value.`, property.line);
  }
  return values[0]!;
};
