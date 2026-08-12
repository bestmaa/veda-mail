import type { CalendarInvitation } from "@/domain/mail/calendar";
import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import {
  asCalendarApiError,
  parseCalendarRouteParams,
} from "@/server/calendar/calendar-invitation-http";
import {
  inspectCalendarPart,
  MAX_CALENDAR_PARTS_PER_MESSAGE,
} from "@/server/calendar/calendar-part-inspection";
import { CalendarParseError } from "@/server/calendar/calendar-parser";
import { serializeCalendarEvent } from "@/server/calendar/calendar-serializer";
import { getMailService } from "@/server/mail/mail-service";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { ApiError } from "@/transport/http/api-error";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";

export const runtime = "nodejs";

interface RouteContext {
  readonly params: Promise<{ readonly messageId: string }>;
}

const normalizedEmail = (value: string): string => value.trim().toLowerCase();

const canRespond = (
  invitation: CalendarInvitation,
  accountEmail: string,
): boolean => invitation.method === "REQUEST" &&
  invitation.event.organizer !== null &&
  invitation.event.attendees.filter(
    ({ email }) => normalizedEmail(email) === normalizedEmail(accountEmail),
  ).length === 1;

export const GET = async (request: Request, context: RouteContext) => {
  try {
    await assertRequestRateLimit(
      request,
      "calendar-invitation-read",
      5_000,
      120,
      60 * 1000,
    );
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    await assertSubjectRateLimit(
      "calendar-invitation-read",
      connection.id,
      60,
      60 * 1000,
    );
    const { messageId } = parseCalendarRouteParams(await context.params);
    const gateway = await getMailService(connection);
    const parts = await gateway.listCalendarParts({
      messageId,
      signal: request.signal,
    });
    if (parts.length > MAX_CALENDAR_PARTS_PER_MESSAGE) {
      throw new ApiError(
        "This message contains too many calendar parts to inspect safely.",
        "CALENDAR_PART_LIMIT_EXCEEDED",
        422,
      );
    }
    if (parts.length === 0) {
      return apiSuccess({ invitations: [], invalidPartCount: 0 });
    }
    const [account, message] = await Promise.all([
      gateway.getAccount(),
      gateway.getMessage(messageId),
    ]);
    const invitations = [];
    let invalidPartCount = 0;
    for (const part of parts) {
      try {
        const inspected = await inspectCalendarPart(
          gateway,
          connection.id,
          messageId,
          part,
          request.signal,
        );
        const organizer = inspected.invitation.event.organizer?.email ?? null;
        invitations.push({
          canRespond: canRespond(inspected.invitation, account.email),
          canonicalIcs: serializeCalendarEvent(inspected.invitation),
          invitation: inspected.invitation,
          organizerMatchesSender: organizer === null
            ? null
            : message.from.some(
                ({ email }) => normalizedEmail(email) === normalizedEmail(organizer),
              ),
          part: inspected.part,
        });
      } catch (error) {
        if (error instanceof CalendarParseError) {
          invalidPartCount += 1;
          continue;
        }
        throw error;
      }
    }
    return apiSuccess({ invitations, invalidPartCount });
  } catch (error) {
    return apiFailure(
      asCalendarApiError(error),
      "Unable to inspect calendar invitations.",
    );
  }
};
