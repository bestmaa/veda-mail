import "server-only";

import { z } from "zod";

import type { ProviderConnection } from "@/domain/provider/provider";
import { id } from "@/domain/shared/brand";
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

const configSchema = z.record(
  z.string().min(1).max(128),
  z.string().max(32 * 1_024),
).refine((value) => Object.keys(value).length <= 64, {
  message: "A stored connection may contain at most 64 configuration fields.",
});

export const storedConnectionSchema: z.ZodType<StoredConnection> = z.object({
  clientLabel: z.string().min(1).max(160),
  connection: z.object({
    config: configSchema,
    createdAt: z.string().datetime(),
    displayName: z.string().min(1).max(160),
    id: z.string().min(1).max(128).transform(id.connection),
    providerId: z.string().min(1).max(128).transform(id.provider),
  }).strict(),
  deliveryNoticeCapacityWarning: z.boolean(),
  lastSeenAt: z.string().datetime(),
  ownerKey: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),
  profileRevision: z.string().min(1).max(256),
}).strict();

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
