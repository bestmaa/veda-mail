import "server-only";

import type { MailGateway } from "@/application/ports/mail-provider.port";
import { getProviderRegistry } from "@/bootstrap/provider-registry";
import type { ProviderConnection } from "@/domain/provider/provider";
import type { ConnectionId } from "@/domain/shared/brand";
import { observeProviderOperation } from "@/server/observability/metrics";
import { observeMailGateway } from "@/server/observability/provider-observer";
import { currentRequestId } from "@/server/observability/request-log";
import {
  logWarn,
  safeErrorType,
} from "@/server/observability/structured-log";

const globalCache = globalThis as typeof globalThis & {
  __vedaMailGateways?: Map<ConnectionId, Promise<MailGateway>>;
};

const gateways =
  globalCache.__vedaMailGateways ?? new Map<ConnectionId, Promise<MailGateway>>();

globalCache.__vedaMailGateways = gateways;

export const resolveGateway = (
  connection: ProviderConnection,
): Promise<MailGateway> => {
  const existing = gateways.get(connection.id);
  if (existing) {
    return existing;
  }
  const providerModule = getProviderRegistry().get(connection.providerId);
  const startedAt = performance.now();
  const gateway = providerModule
    .createGateway(connection)
    .then((created) => {
      observeProviderOperation(
        connection.providerId,
        "connect",
        performance.now() - startedAt,
        "success",
      );
      return observeMailGateway(created, connection.providerId);
    })
    .catch(async (error: unknown) => {
      gateways.delete(connection.id);
      const durationMs = performance.now() - startedAt;
      const requestId = await currentRequestId();
      observeProviderOperation(
        connection.providerId,
        "connect",
        durationMs,
        "error",
      );
      logWarn("provider.connection_failed", {
        durationMs,
        errorType: safeErrorType(error),
        operation: "connect",
        outcome: "error",
        providerId: connection.providerId,
        ...(requestId ? { requestId } : {}),
      });
      throw error;
    });
  gateways.set(connection.id, gateway);
  return gateway;
};

export const clearGateway = (connectionId: ConnectionId): void => {
  gateways.delete(connectionId);
};
