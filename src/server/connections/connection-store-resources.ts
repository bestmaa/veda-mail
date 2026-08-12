import "server-only";

import type { ConnectionId } from "@/domain/shared/brand";
import { twoFactorEnrollmentStore } from "@/server/auth/two-factor-enrollment";
import { clearGateway } from "@/server/mail/gateway-cache";
import { deliveryNoticeStore } from "@/server/mail/delivery-notice-store";
import { sendIdempotencyStore } from "@/server/mail/send-idempotency-store";

export const clearConnectionResources = (connectionId: ConnectionId): void => {
  clearGateway(connectionId);
  deliveryNoticeStore.clear(connectionId);
  sendIdempotencyStore.clear(connectionId);
  twoFactorEnrollmentStore.remove(connectionId);
};
