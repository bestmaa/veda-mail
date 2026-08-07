import "server-only";

import type { ProviderConnection } from "@/domain/provider/provider";
import { MEMBER_CONNECTION_TTL_MS } from "@/domain/provider/connection-lifetime-policy";

export {
  MEMBER_CONNECTION_IDLE_TTL_MS,
  MEMBER_CONNECTION_TTL_MS,
} from "@/domain/provider/connection-lifetime-policy";
export const MEMBER_CONNECTION_TTL_SECONDS =
  MEMBER_CONNECTION_TTL_MS / 1_000;

export const connectionExpiresAtMs = (
  connection: Pick<ProviderConnection, "createdAt">,
): number => {
  const createdAt = Date.parse(connection.createdAt);
  if (!Number.isFinite(createdAt)) {
    throw new RangeError("Mail connection creation time is invalid.");
  }
  const expiresAt = createdAt + MEMBER_CONNECTION_TTL_MS;
  if (
    !Number.isFinite(expiresAt) ||
    !Number.isFinite(new Date(expiresAt).getTime())
  ) {
    throw new RangeError("Mail connection expiry time is invalid.");
  }
  return expiresAt;
};

export const connectionExpiresAt = (
  connection: Pick<ProviderConnection, "createdAt">,
): string => new Date(connectionExpiresAtMs(connection)).toISOString();
