import "server-only";

import type { SendReceipt } from "@/domain/mail/mail";
import type { ConnectionInput, ProviderConnection } from "@/domain/provider/provider";
import type { ConnectionId, DraftId } from "@/domain/shared/brand";
import type { ConnectionSessionMetadata } from
  "@/server/connections/connection-session-record";
import { localConnectionStore } from "@/server/connections/local-connection-store";
import { sharedConnectionStore } from "@/server/connections/shared-connection-store";
import { sharedStateRedisConfigured } from "@/server/shared-state/shared-state-redis";

export type {
  ConnectionSessionMetadata,
  StoredConnection,
} from "@/server/connections/connection-session-record";

const assertLocal = (): void => {
  if (sharedStateRedisConfigured()) {
    throw new Error("Use the asynchronous connection-store API with shared state.");
  }
};

export const connectionStore = {
  beginSendIfActive(
    connection: ProviderConnection,
    draftId: DraftId,
    fingerprint: string,
  ) {
    assertLocal();
    return localConnectionStore.beginSendIfActive(connection, draftId, fingerprint);
  },
  appendDeliveryNoticeIfActive(connection: ProviderConnection, receipt: SendReceipt) {
    assertLocal();
    return localConnectionStore.appendDeliveryNoticeIfActive(connection, receipt);
  },
  create(
    input: ConnectionInput,
    profileRevision: string,
    metadata?: ConnectionSessionMetadata,
  ) {
    assertLocal();
    return localConnectionStore.create(input, profileRevision, metadata);
  },
  get(connectionId: ConnectionId) { assertLocal(); return localConnectionStore.get(connectionId); },
  listAll() { assertLocal(); return localConnectionStore.listAll(); },
  listForOwner(ownerKey: string) {
    assertLocal();
    return localConnectionStore.listForOwner(ownerKey);
  },
  hasDeliveryNoticeCapacityWarning(connection: ProviderConnection) {
    assertLocal();
    return localConnectionStore.hasDeliveryNoticeCapacityWarning(connection);
  },
  isActive(connection: ProviderConnection) {
    assertLocal();
    return localConnectionStore.isActive(connection);
  },
  remove(connectionId: ConnectionId) { assertLocal(); localConnectionStore.remove(connectionId); },
  updateConfig(connectionId: ConnectionId, config: Readonly<Record<string, string>>) {
    assertLocal();
    return localConnectionStore.updateConfig(connectionId, config);
  },
  clearAll() { assertLocal(); localConnectionStore.clearAll(); },

  async beginSendIfActiveAsync(
    connection: ProviderConnection,
    draftId: DraftId,
    fingerprint: string,
  ) {
    return sharedStateRedisConfigured()
      ? sharedConnectionStore.beginSendIfActive(connection, draftId, fingerprint)
      : localConnectionStore.beginSendIfActive(connection, draftId, fingerprint);
  },
  async appendDeliveryNoticeIfActiveAsync(
    connection: ProviderConnection,
    receipt: SendReceipt,
  ) {
    return sharedStateRedisConfigured()
      ? sharedConnectionStore.appendDeliveryNoticeIfActive(connection, receipt)
      : localConnectionStore.appendDeliveryNoticeIfActive(connection, receipt);
  },
  async createAsync(
    input: ConnectionInput,
    profileRevision: string,
    metadata?: ConnectionSessionMetadata,
  ) {
    return sharedStateRedisConfigured()
      ? sharedConnectionStore.create(input, profileRevision, metadata)
      : localConnectionStore.create(input, profileRevision, metadata);
  },
  async getAsync(connectionId: ConnectionId) {
    return sharedStateRedisConfigured()
      ? sharedConnectionStore.get(connectionId) : localConnectionStore.get(connectionId);
  },
  async listAllAsync() {
    return sharedStateRedisConfigured()
      ? sharedConnectionStore.listAll() : localConnectionStore.listAll();
  },
  async listForOwnerAsync(ownerKey: string) {
    return sharedStateRedisConfigured()
      ? sharedConnectionStore.listForOwner(ownerKey)
      : localConnectionStore.listForOwner(ownerKey);
  },
  async hasDeliveryNoticeCapacityWarningAsync(connection: ProviderConnection) {
    return sharedStateRedisConfigured()
      ? sharedConnectionStore.hasDeliveryNoticeCapacityWarning(connection)
      : localConnectionStore.hasDeliveryNoticeCapacityWarning(connection);
  },
  async isActiveAsync(connection: ProviderConnection) {
    return sharedStateRedisConfigured()
      ? sharedConnectionStore.isActive(connection)
      : localConnectionStore.isActive(connection);
  },
  async removeAsync(connectionId: ConnectionId) {
    if (sharedStateRedisConfigured()) await sharedConnectionStore.remove(connectionId);
    else localConnectionStore.remove(connectionId);
  },
  async updateConfigAsync(
    connectionId: ConnectionId,
    config: Readonly<Record<string, string>>,
  ) {
    return sharedStateRedisConfigured()
      ? sharedConnectionStore.updateConfig(connectionId, config)
      : localConnectionStore.updateConfig(connectionId, config);
  },
  async clearAllAsync() {
    if (sharedStateRedisConfigured()) await sharedConnectionStore.clearAll();
    else localConnectionStore.clearAll();
  },
};
