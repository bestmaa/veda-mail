import { MAX_SNOOZE_REQUEST_BYTES } from "@/domain/mail/snooze";
import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import { assertSameOrigin } from "@/server/installation/request-origin";
import { assertRequestRateLimit, assertSubjectRateLimit } from "@/server/security/rate-limit";
import { rescheduleSnooze } from "@/server/snooze/snooze-service";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { readJsonBody } from "@/transport/http/read-json-body";
import { snoozeIdSchema, snoozePatchSchema } from "@/transport/http/snooze.schema";

export const runtime = "nodejs";
interface RouteContext { readonly params: Promise<{ readonly snoozeId: string }> }

export const PATCH = async (request: Request, context: RouteContext) => {
  try {
    assertSameOrigin(request);
    await assertRequestRateLimit(request, "snooze-write", 5_000, 100, 60_000);
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    await assertSubjectRateLimit("snooze-write", connection.id, 30, 15 * 60_000);
    const snoozeId = snoozeIdSchema.parse((await context.params).snoozeId);
    const input = snoozePatchSchema.parse(
      await readJsonBody(request, MAX_SNOOZE_REQUEST_BYTES),
    );
    return apiSuccess(await rescheduleSnooze(connection, snoozeId, input.wakeAt));
  } catch (error) { return apiFailure(error, "Unable to reschedule this snooze."); }
};
