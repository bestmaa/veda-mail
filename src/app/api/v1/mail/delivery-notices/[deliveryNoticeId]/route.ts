import { z } from "zod";

import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertSameOrigin } from "@/server/installation/request-origin";
import { deliveryNoticeStore } from "@/server/mail/delivery-notice-store";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { apiFailure } from "@/transport/http/api-response";

export const runtime = "nodejs";

interface RouteContext {
  readonly params: Promise<{ readonly deliveryNoticeId: string }>;
}

const deliveryNoticeIdSchema = z.string().uuid();

export const DELETE = async (
  request: Request,
  route: RouteContext,
) => {
  try {
    assertSameOrigin(request);
    assertRequestRateLimit(
      request,
      "mail-delivery-notice-dismiss",
      5_000,
      300,
      60 * 1000,
    );
    const connection = await getCurrentConnection();
    assertSubjectRateLimit(
      "mail-delivery-notice-dismiss",
      connection.id,
      120,
      60 * 1000,
    );
    const { deliveryNoticeId } = await route.params;
    deliveryNoticeStore.dismiss(
      connection.id,
      deliveryNoticeIdSchema.parse(deliveryNoticeId),
    );
    return new Response(null, {
      headers: { "Cache-Control": "private, no-store" },
      status: 204,
    });
  } catch (error) {
    return apiFailure(error, "Unable to dismiss this delivery notice.");
  }
};
