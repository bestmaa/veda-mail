import "server-only";

import type { MailGateway } from "@/application/ports/mail-provider.port";
import { getProviderRegistry } from "@/bootstrap/provider-registry";
import type { ProviderConnection } from "@/domain/provider/provider";
import type { ConnectionId } from "@/domain/shared/brand";

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
  const gateway = providerModule.createGateway(connection).catch(
    (error: unknown) => {
      gateways.delete(connection.id);
      throw error;
    },
  );
  gateways.set(connection.id, gateway);
  return gateway;
};

export const clearGateway = (connectionId: ConnectionId): void => {
  gateways.delete(connectionId);
};
