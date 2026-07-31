import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import { loadAttachmentCapability } from "@/server/mail/attachment-service";
import { assertSubjectRateLimit } from "@/server/security/rate-limit";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";

export const runtime = "nodejs";

export const GET = async (request: Request) => {
  try {
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    assertSubjectRateLimit(
      "attachment-capability",
      connection.id,
      60,
      60 * 1_000,
    );
    return apiSuccess(await loadAttachmentCapability(connection));
  } catch (error) {
    return apiFailure(error, "Unable to check attachment availability.");
  }
};
