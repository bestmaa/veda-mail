import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import { readMemberMailForwarding } from "@/server/mail-forwarding/member-mail-forwarding";
import { assertRequestRateLimit, assertSubjectRateLimit } from "@/server/security/rate-limit";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";

export const runtime = "nodejs";

export const GET = async (request: Request) => {
  try {
    await assertRequestRateLimit(request, "member-forwarding-read", 10_000, 240, 60_000);
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    await assertSubjectRateLimit("member-forwarding-read", connection.id, 120, 60_000);
    return apiSuccess(await readMemberMailForwarding(connection));
  } catch (error) {
    return apiFailure(error, "Unable to load administrator-managed forwarding.");
  }
};
