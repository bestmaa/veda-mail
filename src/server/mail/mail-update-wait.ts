import "server-only";

import type { MailUpdateWaitResult } from "@/domain/mail/mail-update";
import type { ProviderConnection } from "@/domain/provider/provider";
import type { ConnectionId } from "@/domain/shared/brand";
import { connectionStore } from "@/server/connections/connection-store";
import { resolveGateway } from "@/server/mail/gateway-cache";
import { ApiError } from "@/transport/http/api-error";

const waits = new Map<ConnectionId, Promise<MailUpdateWaitResult>>();

const normalize = (result: MailUpdateWaitResult): MailUpdateWaitResult => ({
  mode: result.mode,
  retryAfterMs: Math.min(60_000, Math.max(1_000, result.retryAfterMs)),
  shouldRefresh: result.shouldRefresh,
});

export const waitForMailUpdate = (
  connection: ProviderConnection,
): Promise<MailUpdateWaitResult> => {
  const existing = waits.get(connection.id);
  if (existing) return existing;
  const pending = resolveGateway(connection)
    .then((gateway) => gateway.waitForMailUpdate())
    .then(normalize)
    .then((result) => {
      if (!connectionStore.isActive(connection)) {
        throw new ApiError(
          "This mail connection expired. Connect the account again.",
          "MEMBER_SESSION_EXPIRED",
          401,
        );
      }
      return result;
    })
    .finally(() => waits.delete(connection.id));
  waits.set(connection.id, pending);
  return pending;
};
