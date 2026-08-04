import { CALENDAR_LIMITS } from "@/server/calendar/calendar-limits";

const encoder = new TextEncoder();
const forbiddenUriSchemes = new Set([
  "data", "file", "javascript", "vbscript",
]);

export class CalendarParseError extends Error {
  public constructor(message: string, public readonly line?: number) {
    super(line ? `iCalendar line ${line}: ${message}` : `iCalendar: ${message}`);
    this.name = "CalendarParseError";
  }
}

export const calendarUtf8Bytes = (value: string): number =>
  encoder.encode(value).byteLength;

export const hasUnsafeCalendarText = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return (
      code <= 0x09 || code === 0x0b || code === 0x0c ||
      (code >= 0x0e && code <= 0x1f) ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x061c || code === 0x200e || code === 0x200f ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069) || code === 0xfeff
    );
  });

export const assertCalendarText = (
  value: string,
  label: string,
  maximumBytes: number = CALENDAR_LIMITS.textBytes,
  line?: number,
  allowEmpty = false,
): string => {
  if (
    (!allowEmpty && value.length === 0) ||
    calendarUtf8Bytes(value) > maximumBytes ||
    hasUnsafeCalendarText(value) ||
    value !== value.toWellFormed()
  ) {
    throw new CalendarParseError(`${label} is empty, unsafe, or too long.`, line);
  }
  return value;
};

export const decodeCalendarText = (
  input: string,
  label: string,
  maximumBytes: number,
  line?: number,
  allowEmpty = true,
): string => {
  let output = "";
  for (let index = 0; index < input.length; index += 1) {
    const current = input[index]!;
    if (current !== "\\") {
      output += current;
      continue;
    }
    const escaped = input[++index];
    if (escaped === "n" || escaped === "N") output += "\n";
    else if (escaped === "\\" || escaped === "," || escaped === ";") {
      output += escaped;
    } else {
      throw new CalendarParseError(`${label} has a malformed escape.`, line);
    }
  }
  return assertCalendarText(output, label, maximumBytes, line, allowEmpty);
};

export const decodeCalendarParameter = (
  input: string,
  label: string,
  line?: number,
): string => {
  let output = "";
  for (let index = 0; index < input.length; index += 1) {
    const current = input[index]!;
    if (current !== "^") {
      output += current;
      continue;
    }
    const escaped = input[++index];
    if (escaped === "^") output += "^";
    else if (escaped === "'") output += '"';
    else if (escaped === "n" || escaped === "N") output += "\n";
    else throw new CalendarParseError(`${label} has invalid caret encoding.`, line);
  }
  return assertCalendarText(
    output, label, CALENDAR_LIMITS.parameterBytes, line, true,
  );
};

export const assertCalendarEmail = (
  uri: string,
  label: string,
  line?: number,
): string => {
  if (!uri.toLowerCase().startsWith("mailto:")) {
    throw new CalendarParseError(`${label} must use a mailto URI.`, line);
  }
  const email = uri.slice(7);
  if (
    email.length > 254 || email.includes("%") || email.includes("?") ||
    !/^[^\s@<>,;:]+@[^\s@<>,;:]+$/u.test(email) ||
    hasUnsafeCalendarText(email) || email !== email.toWellFormed()
  ) {
    throw new CalendarParseError(`${label} email address is invalid.`, line);
  }
  return email;
};

export const assertIgnoredUriIsSafe = (
  value: string,
  label: string,
  line?: number,
): void => {
  const match = value.trim().match(/^([A-Za-z][A-Za-z0-9+.-]*):/u);
  if (match && forbiddenUriSchemes.has(match[1]!.toLowerCase())) {
    throw new CalendarParseError(`${label} uses a dangerous URI scheme.`, line);
  }
};

export const isRecognizedIanaTimeZone = (value: string): boolean => {
  if (!/^[A-Za-z0-9._+-]+(?:\/[A-Za-z0-9._+-]+)+$/u.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
};
