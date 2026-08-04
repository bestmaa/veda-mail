import { CALENDAR_LIMITS } from "@/server/calendar/calendar-limits";
import {
  CalendarParseError,
  calendarUtf8Bytes,
  hasUnsafeCalendarText,
} from "@/server/calendar/calendar-validation";

export interface CalendarLogicalLine {
  readonly number: number;
  readonly value: string;
}

const decodeInput = (input: Uint8Array | string): string => {
  if (typeof input === "string") {
    if (input !== input.toWellFormed()) {
      throw new CalendarParseError("Input contains malformed Unicode.");
    }
    return input;
  }
  if (input.byteLength > CALENDAR_LIMITS.inputBytes) {
    throw new CalendarParseError("Input is too large.");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(input);
  } catch {
    throw new CalendarParseError("Input is not valid UTF-8.");
  }
};
export const unfoldCalendarLines = (
  input: Uint8Array | string,
): readonly CalendarLogicalLine[] => {
  const decoded = decodeInput(input);
  if (calendarUtf8Bytes(decoded) > CALENDAR_LIMITS.inputBytes) {
    throw new CalendarParseError("Input is too large.");
  }
  const normalized = decoded.replaceAll("\r\n", "\n");
  if (normalized.includes("\r")) {
    throw new CalendarParseError("Bare carriage returns are not allowed.");
  }
  const physical = normalized.split("\n");
  if (physical.length > CALENDAR_LIMITS.physicalLines) {
    throw new CalendarParseError("Input has too many physical lines.");
  }
  const logical: CalendarLogicalLine[] = [];
  for (const [offset, line] of physical.entries()) {
    const continuation = line.startsWith(" ") || line.startsWith("\t");
    if (continuation) {
      const previous = logical.at(-1);
      if (!previous) {
        throw new CalendarParseError("Unexpected folded continuation.", offset + 1);
      }
      logical[logical.length - 1] = {
        number: previous.number,
        value: previous.value + line.slice(1),
      };
    } else {
      logical.push({ number: offset + 1, value: line });
    }
    const current = logical.at(-1)!;
    if (
      hasUnsafeCalendarText(current.value) ||
      calendarUtf8Bytes(current.value) > CALENDAR_LIMITS.unfoldedLineBytes
    ) {
      throw new CalendarParseError(
        "Unfolded content line is unsafe or too long.", current.number,
      );
    }
    if (logical.length > CALENDAR_LIMITS.logicalLines) {
      throw new CalendarParseError("Input has too many logical lines.");
    }
  }
  while (logical.at(-1)?.value === "") logical.pop();
  return logical;
};
