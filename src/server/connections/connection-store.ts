import "server-only";

import type {
  ConnectionInput,
  ProviderConnection,
} from "@/domain/provider/provider";
import type { ConnectionId } from "@/domain/shared/brand";
import { id } from "@/domain/shared/brand";
import { clearGateway } from "@/server/mail/gateway-cache";

const CONNECTION_TTL_MS = 12 * 60 * 60 * 1000;

interface ConnectionState {
  readonly connections: Map<ConnectionId, StoredConnection>;
}

export interface StoredConnection {
  readonly connection: ProviderConnection;
  readonly profileRevision: string;
}

const globalState = globalThis as typeof globalThis & {
  __vedaMailConnections?: ConnectionState;
};

const state: ConnectionState = globalState.__vedaMailConnections ?? {
  connections: new Map(),
};

globalState.__vedaMailConnections = state;

const pruneExpiredConnections = (): void => {
  const expiresBefore = Date.now() - CONNECTION_TTL_MS;
  for (const [connectionId, stored] of state.connections) {
    if (Date.parse(stored.connection.createdAt) < expiresBefore) {
      state.connections.delete(connectionId);
      clearGateway(connectionId);
    }
  }
};

export const connectionStore = {
  create(
    input: ConnectionInput,
    profileRevision: string,
  ): ProviderConnection {
    pruneExpiredConnections();
    const connection: ProviderConnection = {
      ...input,
      createdAt: new Date().toISOString(),
      id: id.connection(crypto.randomUUID()),
    };
    state.connections.set(connection.id, { connection, profileRevision });
    return connection;
  },

  get(connectionId: ConnectionId): StoredConnection | null {
    pruneExpiredConnections();
    return state.connections.get(connectionId) ?? null;
  },

  remove(connectionId: ConnectionId): void {
    state.connections.delete(connectionId);
    clearGateway(connectionId);
  },

  clearAll(): void {
    for (const connectionId of state.connections.keys()) {
      clearGateway(connectionId);
    }
    state.connections.clear();
  },
};
