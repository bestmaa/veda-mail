import "server-only";

import { createHash } from "node:crypto";

import type { SendReceipt } from "@/domain/mail/mail";
import type { ConnectionInput, ProviderConnection } from "@/domain/provider/provider";
import type { ConnectionId, DraftId } from "@/domain/shared/brand";
import { id } from "@/domain/shared/brand";
import { clearConnectionResources } from
  "@/server/connections/connection-store-resources";
import {
  storedConnectionExpiresAt,
  storedConnectionSchema,
  touchStoredConnection,
  type ConnectionSessionMetadata,
  type StoredConnection,
} from "@/server/connections/connection-session-record";
import { clearGateway } from "@/server/mail/gateway-cache";
import { deliveryNoticeStore } from "@/server/mail/delivery-notice-store";
import {
  type SendIdempotencyBegin,
} from "@/server/mail/send-idempotency-store";
import { sharedSendIdempotencyStore } from
  "@/server/mail/shared-send-idempotency-store";
import {
  decryptSharedSession,
  encryptSharedSession,
  sharedSessionOpaqueId,
  sharedSessionOwnerIndex,
} from "@/server/shared-state/shared-session-crypto";
import { sharedSessionRepository } from "@/server/shared-state/shared-session-repository";

const decode = (opaqueId: string, serialized: string): StoredConnection =>
  decryptSharedSession("member", opaqueId, serialized, storedConnectionSchema);

const expiry = (stored: StoredConnection): number => {
  const value = storedConnectionExpiresAt(stored);
  if (value === null || value <= Date.now()) throw new RangeError("Member session is expired.");
  return value;
};

const remove = async (connectionId: ConnectionId, ownerKey?: string): Promise<boolean> => {
  const removed = await sharedSessionRepository.remove({
    kind: "member",
    opaqueId: sharedSessionOpaqueId("member", connectionId),
    ...(ownerKey ? { ownerIndex: sharedSessionOwnerIndex(ownerKey) } : {}),
  });
  clearConnectionResources(connectionId);
  await sharedSendIdempotencyStore.clear(connectionId);
  return removed ?? false;
};

const read = async (
  connectionId: ConnectionId,
  touch: boolean,
): Promise<StoredConnection | null> => {
  const opaqueId = sharedSessionOpaqueId("member", connectionId);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const value = await sharedSessionRepository.get("member", opaqueId);
    if (!value) return null;
    const stored = decode(opaqueId, value.serialized);
    const expiresAt = storedConnectionExpiresAt(stored);
    if (stored.connection.id !== connectionId || expiresAt === null ||
      expiresAt <= Date.now()) {
      await remove(connectionId, stored.ownerKey);
      return null;
    }
    if (!touch) return stored;
    const updated = touchStoredConnection(stored);
    const replaced = await sharedSessionRepository.compareAndSet({
      expected: value.serialized,
      expiresAt: expiry(updated),
      kind: "member",
      opaqueId,
      ownerIndex: sharedSessionOwnerIndex(updated.ownerKey),
      serialized: encryptSharedSession("member", opaqueId, updated),
    });
    if (replaced) return updated;
    if (replaced === null) return null;
  }
  return null;
};

const list = async (ownerKey?: string): Promise<readonly StoredConnection[]> => {
  const records = await sharedSessionRepository.list(
    "member", ownerKey ? sharedSessionOwnerIndex(ownerKey) : undefined,
  );
  if (!records) return [];
  const active: StoredConnection[] = [];
  for (const value of records) {
    const stored = decode(value.opaqueId, value.serialized);
    const expiresAt = storedConnectionExpiresAt(stored);
    if (expiresAt === null || expiresAt <= Date.now()) {
      await remove(stored.connection.id, stored.ownerKey);
    } else if (!ownerKey || stored.ownerKey === ownerKey) active.push(stored);
  }
  return active.toSorted((left, right) =>
    right.lastSeenAt.localeCompare(left.lastSeenAt));
};

const replace = async (
  connectionId: ConnectionId,
  update: (stored: StoredConnection) => StoredConnection,
): Promise<StoredConnection> => {
  const opaqueId = sharedSessionOpaqueId("member", connectionId);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const value = await sharedSessionRepository.get("member", opaqueId);
    if (!value) throw new Error("Mail connection was not found.");
    const updated = storedConnectionSchema.parse(update(decode(opaqueId, value.serialized)));
    const replaced = await sharedSessionRepository.compareAndSet({
      expected: value.serialized,
      expiresAt: expiry(updated),
      kind: "member",
      opaqueId,
      ownerIndex: sharedSessionOwnerIndex(updated.ownerKey),
      serialized: encryptSharedSession("member", opaqueId, updated),
    });
    if (replaced) return updated;
    if (replaced === null) break;
  }
  throw new Error("Mail connection changed concurrently. Retry the operation.");
};

export const sharedConnectionStore = {
  async beginSendIfActive(
    connection: ProviderConnection,
    draftId: DraftId,
    fingerprint: string,
  ): Promise<SendIdempotencyBegin | { readonly kind: "inactive" }> {
    const stored = await read(connection.id, false);
    const current = stored?.connection;
    if (!stored || !current || current.createdAt !== connection.createdAt ||
      current.providerId !== connection.providerId) return { kind: "inactive" };
    const expiresAt = storedConnectionExpiresAt(stored);
    if (expiresAt === null || expiresAt <= Date.now()) {
      await remove(connection.id, stored.ownerKey);
      return { kind: "inactive" };
    }
    return sharedSendIdempotencyStore.begin(connection.id, draftId, fingerprint, expiresAt);
  },

  async appendDeliveryNoticeIfActive(
    connection: ProviderConnection,
    receipt: SendReceipt,
  ): Promise<boolean> {
    const stored = await read(connection.id, false);
    const current = stored?.connection;
    if (!stored || !current || current.createdAt !== connection.createdAt ||
      current.providerId !== connection.providerId) return false;
    const expiresAt = storedConnectionExpiresAt(stored);
    if (expiresAt === null || expiresAt <= Date.now()) {
      await remove(connection.id, stored.ownerKey);
      return false;
    }
    const admitted = deliveryNoticeStore.append(connection.id, receipt, expiresAt);
    if (!admitted) await replace(connection.id, (value) => ({
      ...value, deliveryNoticeCapacityWarning: true,
    }));
    return admitted;
  },

  async create(
    input: ConnectionInput,
    profileRevision: string,
    metadata?: ConnectionSessionMetadata,
  ): Promise<ProviderConnection> {
    const connection: ProviderConnection = {
      ...input, createdAt: new Date().toISOString(), id: id.connection(crypto.randomUUID()),
    };
    const stored = storedConnectionSchema.parse({
      clientLabel: metadata?.clientLabel ?? "Unknown client",
      connection,
      deliveryNoticeCapacityWarning: false,
      lastSeenAt: connection.createdAt,
      ownerKey: metadata?.ownerKey ?? createHash("sha256")
        .update(connection.id).digest("base64url"),
      profileRevision,
    });
    const opaqueId = sharedSessionOpaqueId("member", connection.id);
    await sharedSessionRepository.create({
      expiresAt: expiry(stored),
      kind: "member",
      opaqueId,
      ownerIndex: sharedSessionOwnerIndex(stored.ownerKey),
      serialized: encryptSharedSession("member", opaqueId, stored),
    });
    return connection;
  },

  get: (connectionId: ConnectionId) => read(connectionId, true),
  listAll: () => list(),
  listForOwner: (ownerKey: string) => list(ownerKey),

  async hasDeliveryNoticeCapacityWarning(connection: ProviderConnection): Promise<boolean> {
    const stored = await read(connection.id, false);
    return Boolean(stored?.deliveryNoticeCapacityWarning &&
      stored.connection.createdAt === connection.createdAt &&
      stored.connection.providerId === connection.providerId);
  },

  async isActive(connection: ProviderConnection): Promise<boolean> {
    const stored = await read(connection.id, false);
    return Boolean(stored && stored.connection.createdAt === connection.createdAt &&
      stored.connection.providerId === connection.providerId);
  },

  async remove(connectionId: ConnectionId): Promise<void> {
    const stored = await read(connectionId, false);
    await remove(connectionId, stored?.ownerKey);
  },

  async updateConfig(
    connectionId: ConnectionId,
    config: Readonly<Record<string, string>>,
  ): Promise<ProviderConnection> {
    const stored = await replace(connectionId, (current) => ({
      ...current, connection: { ...current.connection, config },
    }));
    clearGateway(connectionId);
    return stored.connection;
  },

  async clearAll(): Promise<void> {
    const records = await list();
    await sharedSessionRepository.clear("member");
    for (const stored of records) {
      clearConnectionResources(stored.connection.id);
      await sharedSendIdempotencyStore.clear(stored.connection.id);
    }
  },
};
