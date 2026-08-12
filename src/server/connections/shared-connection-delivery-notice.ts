import "server-only";

import type { ProviderConnection } from "@/domain/provider/provider";
import {
  storedConnectionExpiresAt,
  storedConnectionSchema,
} from "@/server/connections/connection-session-record";
import {
  decryptSharedSession,
  encryptSharedSession,
  sharedSessionOpaqueId,
  sharedSessionOwnerIndex,
} from "@/server/shared-state/shared-session-crypto";
import { sharedSessionRepository } from
  "@/server/shared-state/shared-session-repository";

export const markSharedConnectionDeliveryNoticeCapacity = async (
  connection: ProviderConnection,
): Promise<boolean> => {
  const opaqueId = sharedSessionOpaqueId("member", connection.id);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const value = await sharedSessionRepository.get("member", opaqueId);
    if (!value) return false;
    const stored = decryptSharedSession(
      "member",
      opaqueId,
      value.serialized,
      storedConnectionSchema,
    );
    const expiresAt = storedConnectionExpiresAt(stored);
    if (stored.connection.createdAt !== connection.createdAt ||
      stored.connection.providerId !== connection.providerId ||
      expiresAt === null || expiresAt <= Date.now()) return false;
    const updated = storedConnectionSchema.parse({
      ...stored,
      deliveryNoticeCapacityWarning: true,
    });
    const replaced = await sharedSessionRepository.compareAndSet({
      expected: value.serialized,
      expiresAt,
      kind: "member",
      opaqueId,
      ownerIndex: sharedSessionOwnerIndex(updated.ownerKey),
      serialized: encryptSharedSession("member", opaqueId, updated),
    });
    if (replaced) return true;
    if (replaced === null) return false;
  }
  throw new Error("Mail connection changed concurrently. Retry the operation.");
};
