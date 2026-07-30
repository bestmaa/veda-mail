import "server-only";

import type {
  ConnectionInput,
  ProviderConnection,
} from "@/domain/provider/provider";
import type { SendReceipt } from "@/domain/mail/mail";
import type { ConnectionId, DraftId } from "@/domain/shared/brand";
import { id } from "@/domain/shared/brand";
import { clearGateway } from "@/server/mail/gateway-cache";
import { deliveryNoticeStore } from "@/server/mail/delivery-notice-store";
import {
  sendIdempotencyStore,
  type SendIdempotencyBegin,
} from "@/server/mail/send-idempotency-store";

const CONNECTION_TTL_MS = 12 * 60 * 60 * 1000;

interface ConnectionState {
  readonly connections: Map<ConnectionId, StoredConnection>;
}

export interface StoredConnection {
  readonly connection: ProviderConnection;
  readonly deliveryNoticeCapacityWarning: boolean;
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
      deliveryNoticeStore.clear(connectionId);
      sendIdempotencyStore.clear(connectionId);
    }
  }
};

export const connectionStore = {
  beginSendIfActive(
    connection: ProviderConnection,
    draftId: DraftId,
    fingerprint: string,
  ): SendIdempotencyBegin | { readonly kind: "inactive" } {
    pruneExpiredConnections();
    const current = state.connections.get(connection.id)?.connection;
    if (
      !current ||
      current.createdAt !== connection.createdAt ||
      current.providerId !== connection.providerId
    ) {
      return { kind: "inactive" };
    }
    const expiresAt = Date.parse(current.createdAt) + CONNECTION_TTL_MS;
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      state.connections.delete(connection.id);
      clearGateway(connection.id);
      deliveryNoticeStore.clear(connection.id);
      sendIdempotencyStore.clear(connection.id);
      return { kind: "inactive" };
    }
    return sendIdempotencyStore.begin(
      connection.id,
      draftId,
      fingerprint,
      expiresAt,
    );
  },

  appendDeliveryNoticeIfActive(
    connection: ProviderConnection,
    receipt: SendReceipt,
  ): boolean {
    pruneExpiredConnections();
    const stored = state.connections.get(connection.id);
    const current = stored?.connection;
    if (
      !current ||
      current.createdAt !== connection.createdAt ||
      current.providerId !== connection.providerId
    ) {
      return false;
    }
    const expiresAt = Date.parse(current.createdAt) + CONNECTION_TTL_MS;
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      state.connections.delete(connection.id);
      clearGateway(connection.id);
      deliveryNoticeStore.clear(connection.id);
      sendIdempotencyStore.clear(connection.id);
      return false;
    }
    const admitted = deliveryNoticeStore.append(
      connection.id,
      receipt,
      expiresAt,
    );
    if (!admitted && stored) {
      state.connections.set(connection.id, {
        ...stored,
        deliveryNoticeCapacityWarning: true,
      });
    }
    return admitted;
  },

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
    state.connections.set(connection.id, {
      connection,
      deliveryNoticeCapacityWarning: false,
      profileRevision,
    });
    return connection;
  },

  get(connectionId: ConnectionId): StoredConnection | null {
    pruneExpiredConnections();
    return state.connections.get(connectionId) ?? null;
  },

  hasDeliveryNoticeCapacityWarning(connection: ProviderConnection): boolean {
    pruneExpiredConnections();
    const stored = state.connections.get(connection.id);
    const current = stored?.connection;
    return Boolean(
      stored?.deliveryNoticeCapacityWarning &&
        current?.createdAt === connection.createdAt &&
        current.providerId === connection.providerId,
    );
  },

  remove(connectionId: ConnectionId): void {
    state.connections.delete(connectionId);
    clearGateway(connectionId);
    deliveryNoticeStore.clear(connectionId);
    sendIdempotencyStore.clear(connectionId);
  },

  updateConfig(
    connectionId: ConnectionId,
    config: Readonly<Record<string, string>>,
  ): ProviderConnection {
    const stored = state.connections.get(connectionId);
    if (!stored) {
      throw new Error("Mail connection was not found.");
    }
    const connection = { ...stored.connection, config };
    state.connections.set(connectionId, { ...stored, connection });
    clearGateway(connectionId);
    return connection;
  },

  clearAll(): void {
    for (const connectionId of state.connections.keys()) {
      clearGateway(connectionId);
    }
    state.connections.clear();
    deliveryNoticeStore.clearAll();
    sendIdempotencyStore.clearAll();
  },
};
