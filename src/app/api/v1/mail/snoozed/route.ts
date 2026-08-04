import { MAX_SNOOZE_REQUEST_BYTES } from "@/domain/mail/snooze";
import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import { assertSameOrigin } from "@/server/installation/request-origin";
import {
  createSnoozes,
  readSnoozeWorkspace,
  snoozeBulkHttpStatus,
} from "@/server/snooze/snooze-service";
import { assertRequestRateLimit, assertSubjectRateLimit } from "@/server/security/rate-limit";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { readJsonBody } from "@/transport/http/read-json-body";
import { parseSnoozeBulk } from "@/transport/http/snooze.schema";

export const runtime = "nodejs";
export const GET = async (request: Request) => {
  try {
    assertRequestRateLimit(request, "snooze-read", 10_000, 300, 60_000);
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    assertSubjectRateLimit("snooze-read", connection.id, 120, 60_000);
    return apiSuccess(await readSnoozeWorkspace(connection));
  } catch (error) { return apiFailure(error, "Unable to load snoozed messages."); }
};
export const POST = async (request: Request) => {
  try {
    assertSameOrigin(request);
    assertRequestRateLimit(request, "snooze-write", 5_000, 100, 60_000);
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    const items = parseSnoozeBulk(await readJsonBody(request, MAX_SNOOZE_REQUEST_BYTES));
    assertSubjectRateLimit("snooze-write", connection.id, 100, 15 * 60_000, items.length);
    assertMailSessionScope(request, connection);
    const result = await createSnoozes(connection, items);
    return apiSuccess(result, { status: snoozeBulkHttpStatus(result.outcomes) });
  } catch (error) { return apiFailure(error, "Unable to snooze messages."); }
};
