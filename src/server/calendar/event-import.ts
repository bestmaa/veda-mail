import "server-only";

import type { CalendarEvent } from "@/domain/mail/calendar";
import { parseCalendarInvitation } from "@/server/calendar/calendar-parser";
import { calendarEventSchema } from "@/server/calendar/event-record";
import { ApiError } from "@/transport/http/api-error";

export const parseCalendarEventImport = (ics: string): CalendarEvent => {
  try {
    const invitation = parseCalendarInvitation(ics);
    if (invitation.method !== "PUBLISH" && invitation.method !== "REQUEST") {
      throw new Error("method");
    }
    return calendarEventSchema.parse(invitation.event) as CalendarEvent;
  } catch {
    throw new ApiError(
      "Import one valid PUBLISH or REQUEST calendar event.",
      "CALENDAR_EVENT_IMPORT_INVALID",
      422,
    );
  }
};
