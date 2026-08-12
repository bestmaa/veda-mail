import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import {
  asCalendarApiError,
  MAX_CALENDAR_RESPONSE_REQUEST_BYTES,
  parseCalendarResponse,
  parseCalendarRouteParams,
} from "@/server/calendar/calendar-invitation-http";
import { respondToCalendarInvitation } from "@/server/calendar/calendar-response";
import { assertSameOrigin } from "@/server/installation/request-origin";
import { getMailService } from "@/server/mail/mail-service";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { readJsonBody } from "@/transport/http/read-json-body";

export const runtime = "nodejs";

interface RouteContext {
  readonly params: Promise<{ readonly messageId: string }>;
}

export const POST = async (request: Request, context: RouteContext) => {
  try {
    assertSameOrigin(request);
    await assertRequestRateLimit(
      request,
      "calendar-invitation-response",
      5_000,
      60,
      60 * 1000,
    );
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    await assertSubjectRateLimit(
      "calendar-invitation-response",
      connection.id,
      20,
      15 * 60 * 1000,
    );
    const { messageId } = parseCalendarRouteParams(await context.params);
    const response = parseCalendarResponse(
      await readJsonBody(request, MAX_CALENDAR_RESPONSE_REQUEST_BYTES),
    );
    return apiSuccess(await respondToCalendarInvitation({
      connection,
      gateway: await getMailService(connection),
      idempotencyKey: response.idempotencyKey,
      messageId,
      partId: response.partId,
      participationStatus: response.participationStatus,
      signal: request.signal,
    }), { status: 201 });
  } catch (error) {
    return apiFailure(
      asCalendarApiError(error),
      "Unable to send the calendar response.",
    );
  }
};
