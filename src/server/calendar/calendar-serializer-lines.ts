import { CALENDAR_LIMITS } from "@/server/calendar/calendar-limits";
import {
  CalendarParseError,
  assertCalendarText,
  calendarUtf8Bytes,
} from "@/server/calendar/calendar-validation";

export const escapeCalendarText = (
  value: string,
  label: string,
  maximumBytes: number,
  allowEmpty = true,
): string => assertCalendarText(
  value, label, maximumBytes, undefined, allowEmpty,
).replaceAll("\\", "\\\\")
  .replaceAll("\n", "\\n")
  .replaceAll(";", "\\;")
  .replaceAll(",", "\\,");

export const encodeCalendarParameter = (
  value: string,
  label: string,
): string => {
  const safe = assertCalendarText(
    value, label, CALENDAR_LIMITS.parameterBytes, undefined, true,
  );
  return `"${safe.replaceAll("^", "^^").replaceAll('"', "^'")
    .replaceAll("\n", "^n")}"`;
};

export const foldCalendarLine = (line: string): string => {
  if (line.includes("\r") || line.includes("\n")) {
    throw new CalendarParseError("Serialized content line contains a newline.");
  }
  const chunks: string[] = [];
  let chunk = "";
  for (const scalar of line) {
    const limit = chunks.length === 0 ? 75 : 74;
    if (chunk && calendarUtf8Bytes(chunk + scalar) > limit) {
      chunks.push(chunk);
      chunk = scalar;
    } else {
      chunk += scalar;
    }
  }
  chunks.push(chunk);
  return chunks.join("\r\n ");
};

export const serializeCalendarLines = (lines: readonly string[]): string =>
  `${lines.map(foldCalendarLine).join("\r\n")}\r\n`;

export const assertCalendarSerializedSize = (
  value: string,
  maximumBytes: number,
): string => {
  if (calendarUtf8Bytes(value) > maximumBytes) {
    throw new CalendarParseError("Serialized calendar is too large.");
  }
  return value;
};
