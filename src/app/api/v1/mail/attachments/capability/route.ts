import { getCurrentConnection } from "@/server/connections/connection-session";
import { loadAttachmentCapability } from "@/server/mail/attachment-service";
import { assertSubjectRateLimit } from "@/server/security/rate-limit";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";

export const runtime = "nodejs";

export const GET = async () => {
  try {
    const connection = await getCurrentConnection();
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
