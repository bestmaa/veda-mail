import "server-only";

import type { CalendarEvent } from "@/domain/mail/calendar";
import { serializeCalendarEvents } from "@/server/calendar/calendar-serializer";
import {
  calendarEventSchema,
  compareCalendarEvents,
  MAX_CALENDAR_EVENTS_PER_OWNER,
} from "@/server/calendar/event-record";
import { ApiError } from "@/transport/http/api-error";

export const exportCalendarEvents = (
  events: readonly CalendarEvent[],
): string => {
  try {
    if (events.length > MAX_CALENDAR_EVENTS_PER_OWNER) throw new Error("limit");
    const canonical = events.map((event) =>
      calendarEventSchema.parse(event) as CalendarEvent).sort(compareCalendarEvents);
    return serializeCalendarEvents(canonical);
  } catch {
    throw new ApiError(
      "Calendar events could not be exported safely.",
      "CALENDAR_EVENT_EXPORT_INVALID",
      500,
    );
  }
};
