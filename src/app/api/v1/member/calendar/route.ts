import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import {
  calendarEventOwnerForConnection,
} from "@/server/calendar/event-owner";
import {
  parseCalendarEventImport,
} from "@/server/calendar/event-import";
import {
  MAX_CALENDAR_IMPORT_REQUEST_BYTES,
  parseCalendarEventRouteOperation,
  removeCalendarEventOperation,
} from "@/server/calendar/event-schema";
import { calendarEventStore } from "@/server/calendar/event-store";
import { assertSameOrigin } from "@/server/installation/request-origin";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { readJsonBody } from "@/transport/http/read-json-body";

export const runtime = "nodejs";

export const GET = async (request: Request) => {
  try {
    await assertRequestRateLimit(
      request,
      "member-calendar-event-read",
      10_000,
      600,
      60 * 1000,
    );
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    await assertSubjectRateLimit(
      "member-calendar-event-read",
      connection.id,
      120,
      60 * 1000,
    );
    return apiSuccess(
      await calendarEventStore.get(
        await calendarEventOwnerForConnection(connection),
      ),
    );
  } catch (error) {
    return apiFailure(error, "Unable to load calendar events.");
  }
};

export const PUT = async (request: Request) => {
  try {
    assertSameOrigin(request);
    await assertRequestRateLimit(
      request,
      "member-calendar-event-write",
      5_000,
      120,
      60 * 1000,
    );
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    await assertSubjectRateLimit(
      "member-calendar-event-write",
      connection.id,
      20,
      15 * 60 * 1000,
    );
    const operation = parseCalendarEventRouteOperation(
      await readJsonBody(request, MAX_CALENDAR_IMPORT_REQUEST_BYTES),
    );
    const mutation = operation.operation === "import-event"
      ? {
          event: parseCalendarEventImport(operation.ics),
          expectedRevision: operation.expectedRevision,
          operation: "import-event" as const,
        }
      : removeCalendarEventOperation(operation);
    const book = await calendarEventStore.put(
      await calendarEventOwnerForConnection(connection),
      mutation,
    );
    return apiSuccess(book, {
      status: operation.operation === "import-event" ? 201 : 200,
    });
  } catch (error) {
    return apiFailure(error, "Unable to update calendar events.");
  }
};
