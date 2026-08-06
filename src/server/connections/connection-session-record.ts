import "server-only";

import type { ProviderConnection } from "@/domain/provider/provider";
import {
  MEMBER_CONNECTION_IDLE_TTL_MS,
  connectionExpiresAtMs,
} from "@/server/connections/connection-lifetime";

export interface StoredConnection {
  readonly clientLabel: string;
  readonly connection: ProviderConnection;
  readonly deliveryNoticeCapacityWarning: boolean;
  readonly lastSeenAt: string;
  readonly ownerKey: string;
  readonly profileRevision: string;
}

export interface ConnectionSessionMetadata {
  readonly clientLabel: string;
  readonly ownerKey: string;
}

export const storedConnectionExpiresAt = (
  stored: StoredConnection,
): number | null => {
  try {
    const absoluteExpiry = connectionExpiresAtMs(stored.connection);
    const idleExpiry =
      Date.parse(stored.lastSeenAt) + MEMBER_CONNECTION_IDLE_TTL_MS;
    const expiresAt = Math.min(absoluteExpiry, idleExpiry);
    return Number.isFinite(expiresAt) ? expiresAt : null;
  } catch {
    return null;
  }
};

export const touchStoredConnection = (
  stored: StoredConnection,
  now = Date.now(),
): StoredConnection => ({
  ...stored,
  lastSeenAt: new Date(now).toISOString(),
});
