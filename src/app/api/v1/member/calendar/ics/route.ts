import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import { exportCalendarEvents } from "@/server/calendar/event-export";
import {
  calendarEventOwnerForConnection,
} from "@/server/calendar/event-owner";
import { calendarEventStore } from "@/server/calendar/event-store";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { apiFailure } from "@/transport/http/api-response";

export const runtime = "nodejs";

export const GET = async (request: Request) => {
  try {
    assertRequestRateLimit(
      request,
      "member-calendar-event-export",
      10_000,
      60,
      60 * 1000,
    );
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    assertSubjectRateLimit(
      "member-calendar-event-export",
      connection.id,
      20,
      15 * 60 * 1000,
    );
    const book = await calendarEventStore.get(
      await calendarEventOwnerForConnection(connection),
    );
    return new Response(exportCalendarEvents(book.events), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": 'attachment; filename="veda-mail-calendar.ics"',
        "Content-Type": "text/calendar; charset=utf-8",
        "Cross-Origin-Resource-Policy": "same-origin",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiFailure(error, "Unable to export calendar events.");
  }
};
