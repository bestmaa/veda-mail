import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import { connectionStore } from "@/server/connections/connection-store";
import {
  DELIVERY_NOTICE_OVERFLOW_MESSAGE,
} from "@/server/mail/delivery-notice-store";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";

export const runtime = "nodejs";

export const GET = async (request: Request) => {
  try {
    assertRequestRateLimit(
      request,
      "mail-delivery-notice-read",
      10_000,
      600,
      60 * 1000,
    );
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    assertSubjectRateLimit(
      "mail-delivery-notice-read",
      connection.id,
      120,
      60 * 1000,
    );
    const notices = await connectionStore.listDeliveryNoticesAsync(connection.id);
    return apiSuccess({
      notices: (await connectionStore.hasDeliveryNoticeCapacityWarningAsync(connection))
        ? [
            ...notices,
            {
              kind: "overflow" as const,
              message: DELIVERY_NOTICE_OVERFLOW_MESSAGE,
            },
          ]
        : notices,
    });
  } catch (error) {
    return apiFailure(error, "Unable to load delivery notices.");
  }
};
