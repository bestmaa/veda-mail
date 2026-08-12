import "server-only";

import { createHash } from "node:crypto";

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
import { sharedStateRedisConfigured } from
  "@/server/shared-state/shared-state-redis";

const globalCache = globalThis as typeof globalThis & {
  __vedaMailGateways?: Map<ConnectionId, {
    readonly fingerprint: string;
    readonly gateway: Promise<MailGateway>;
  }>;
};

const gateways =
  globalCache.__vedaMailGateways ?? new Map();

globalCache.__vedaMailGateways = gateways;

export const resolveGateway = (
  connection: ProviderConnection,
): Promise<MailGateway> => {
  const cacheEnabled = !sharedStateRedisConfigured();
  const fingerprint = createHash("sha256").update(JSON.stringify({
    config: Object.entries(connection.config).toSorted(([left], [right]) =>
      left.localeCompare(right)),
    createdAt: connection.createdAt,
    providerId: connection.providerId,
  })).digest("base64url");
  const existing = cacheEnabled ? gateways.get(connection.id) : undefined;
  if (existing?.fingerprint === fingerprint) {
    return existing.gateway;
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
      if (gateways.get(connection.id)?.gateway === gateway) {
        gateways.delete(connection.id);
      }
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
  if (cacheEnabled) gateways.set(connection.id, { fingerprint, gateway });
  return gateway;
};

export const clearGateway = (connectionId: ConnectionId): void => {
  gateways.delete(connectionId);
};
