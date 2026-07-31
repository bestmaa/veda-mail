import "server-only";

import type { ConnectionInput, ProviderConnection } from "@/domain/provider/provider";
import type { SendReceipt } from "@/domain/mail/mail";
import type { ConnectionId, DraftId } from "@/domain/shared/brand";
import { id } from "@/domain/shared/brand";
import { twoFactorEnrollmentStore } from "@/server/auth/two-factor-enrollment";
import { connectionExpiresAtMs } from "@/server/connections/connection-lifetime";
import { clearGateway } from "@/server/mail/gateway-cache";
import { deliveryNoticeStore } from "@/server/mail/delivery-notice-store";
import {
  sendIdempotencyStore,
  type SendIdempotencyBegin,
} from "@/server/mail/send-idempotency-store";

interface ConnectionState {
  readonly connections: Map<ConnectionId, StoredConnection>;
  readonly expiryTimers: Map<ConnectionId, ReturnType<typeof setTimeout>>;
}

export interface StoredConnection {
  readonly connection: ProviderConnection;
  readonly deliveryNoticeCapacityWarning: boolean;
  readonly profileRevision: string;
}

const globalState = globalThis as typeof globalThis & {
  __vedaMailConnections?: Partial<ConnectionState> &
    Pick<ConnectionState, "connections">;
};

const existingState = globalState.__vedaMailConnections;
const state: ConnectionState = {
  connections: existingState?.connections ?? new Map(),
  expiryTimers: existingState?.expiryTimers ?? new Map(),
};

globalState.__vedaMailConnections = state;

const clearConnectionResources = (connectionId: ConnectionId): void => {
  clearGateway(connectionId);
  deliveryNoticeStore.clear(connectionId);
  sendIdempotencyStore.clear(connectionId);
  twoFactorEnrollmentStore.remove(connectionId);
};

const removeStoredConnection = (
  connectionId: ConnectionId,
  expectedCreatedAt?: string,
): boolean => {
  const stored = state.connections.get(connectionId);
  if (!stored) {
    if (expectedCreatedAt) return false;
    const timer = state.expiryTimers.get(connectionId);
    if (timer) clearTimeout(timer);
    state.expiryTimers.delete(connectionId);
    clearConnectionResources(connectionId);
    return false;
  }
  if (expectedCreatedAt && stored.connection.createdAt !== expectedCreatedAt) {
    return false;
  }
  state.connections.delete(connectionId);
  const timer = state.expiryTimers.get(connectionId);
  if (timer) clearTimeout(timer);
  state.expiryTimers.delete(connectionId);
  clearConnectionResources(connectionId);
  return true;
};

const expiresAtOrNull = (connection: ProviderConnection): number | null => {
  try {
    const expiresAt = connectionExpiresAtMs(connection);
    return Number.isFinite(expiresAt) ? expiresAt : null;
  } catch {
    return null;
  }
};

const scheduleExpiry = (connection: ProviderConnection): void => {
  const existingTimer = state.expiryTimers.get(connection.id);
  if (existingTimer) clearTimeout(existingTimer);
  state.expiryTimers.delete(connection.id);
  const expiresAt = expiresAtOrNull(connection);
  const remaining = expiresAt === null ? 0 : expiresAt - Date.now();
  if (remaining <= 0) {
    removeStoredConnection(connection.id, connection.createdAt);
    return;
  }
  const timer = setTimeout(() => {
    removeStoredConnection(connection.id, connection.createdAt);
  }, remaining);
  timer.unref();
  state.expiryTimers.set(connection.id, timer);
};

const pruneExpiredConnections = (): void => {
  for (const [connectionId, stored] of state.connections) {
    const expiresAt = expiresAtOrNull(stored.connection);
    if (expiresAt === null || expiresAt <= Date.now()) {
      removeStoredConnection(connectionId, stored.connection.createdAt);
    }
  }
};

for (const { connection } of state.connections.values()) {
  scheduleExpiry(connection);
}

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
    const expiresAt = expiresAtOrNull(current);
    if (expiresAt === null || expiresAt <= Date.now()) {
      removeStoredConnection(connection.id, current.createdAt);
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
    const expiresAt = expiresAtOrNull(current);
    if (expiresAt === null || expiresAt <= Date.now()) {
      removeStoredConnection(connection.id, current.createdAt);
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
    scheduleExpiry(connection);
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

  isActive(connection: ProviderConnection): boolean {
    pruneExpiredConnections();
    const current = state.connections.get(connection.id)?.connection;
    return Boolean(
      current &&
        current.createdAt === connection.createdAt &&
        current.providerId === connection.providerId,
    );
  },

  remove(connectionId: ConnectionId): void {
    removeStoredConnection(connectionId);
  },

  updateConfig(
    connectionId: ConnectionId,
    config: Readonly<Record<string, string>>,
  ): ProviderConnection {
    pruneExpiredConnections();
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
    for (const timer of state.expiryTimers.values()) {
      clearTimeout(timer);
    }
    state.expiryTimers.clear();
    for (const connectionId of state.connections.keys()) {
      clearGateway(connectionId);
      twoFactorEnrollmentStore.remove(connectionId);
    }
    state.connections.clear();
    deliveryNoticeStore.clearAll();
    sendIdempotencyStore.clearAll();
  },
};
