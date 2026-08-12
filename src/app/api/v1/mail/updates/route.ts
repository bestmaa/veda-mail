import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import { waitForMailUpdate } from "@/server/mail/mail-update-wait";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";

export const runtime = "nodejs";

export const GET = async (request: Request) => {
  try {
    await assertRequestRateLimit(request, "mail-updates", 10_000, 1_000, 60_000);
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    await assertSubjectRateLimit("mail-updates", connection.id, 120, 60 * 60_000);
    const result = await waitForMailUpdate(connection);
    return apiSuccess(result);
  } catch (error) {
    return apiFailure(error, "Unable to wait for mailbox updates.");
  }
};
