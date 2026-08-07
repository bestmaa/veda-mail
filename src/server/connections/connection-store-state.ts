import "server-only";

import type { ConnectionId } from "@/domain/shared/brand";
import type { StoredConnection } from "@/server/connections/connection-session-record";

export interface ConnectionState {
  readonly connections: Map<ConnectionId, StoredConnection>;
  readonly expiryTimers: Map<ConnectionId, ReturnType<typeof setTimeout>>;
}

const globalState = globalThis as typeof globalThis & {
  __vedaMailConnections?: Partial<ConnectionState> &
    Pick<ConnectionState, "connections">;
};
const existingState = globalState.__vedaMailConnections;
export const connectionState: ConnectionState = {
  connections: existingState?.connections ?? new Map(),
  expiryTimers: existingState?.expiryTimers ?? new Map(),
};
globalState.__vedaMailConnections = connectionState;
