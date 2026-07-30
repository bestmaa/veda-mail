import "server-only";

import type { SendReceipt } from "@/domain/mail/mail";
import type { ConnectionId, DraftId } from "@/domain/shared/brand";
import {
  bucketBytes,
  boundedConnectionExpiry,
  MAX_SEND_IDEMPOTENCY_BYTES,
  MAX_SEND_IDEMPOTENCY_BYTES_PER_CONNECTION,
  MAX_SEND_IDEMPOTENCY_CONNECTIONS,
  MAX_SEND_IDEMPOTENCY_GLOBAL,
  MAX_SEND_IDEMPOTENCY_PENDING_BYTES_PER_CONNECTION,
  MAX_SEND_IDEMPOTENCY_PENDING_PER_CONNECTION,
  MAX_SEND_IDEMPOTENCY_PER_CONNECTION,
  pendingBytes,
  pendingCount,
  SEND_IDEMPOTENCY_PENDING_BYTES,
  SEND_IDEMPOTENCY_TTL_MS,
  validSendFingerprint,
} from "@/server/mail/send-idempotency-budget";
import {
  cloneSendReceipt,
  reservedSendReceipt,
} from "@/server/mail/send-idempotency-receipt";
import type {
  PendingSendEntry,
  SendBucket,
  SendEntry,
  SendIdempotencyBegin,
  SendIdempotencyOutcome,
  SendIdempotencyState,
} from "@/server/mail/send-idempotency-types";
export * from "@/server/mail/send-idempotency-budget";
export type {
  SendIdempotencyBegin,
  SendIdempotencyOutcome,
} from "@/server/mail/send-idempotency-types";

const globalState = globalThis as typeof globalThis & {
  __vedaMailSendIdempotency?: unknown;
  __vedaMailSendIdempotencyV2?: unknown;
  __vedaMailSendIdempotencyV3?: SendIdempotencyState;
};

const state: SendIdempotencyState =
  globalState.__vedaMailSendIdempotencyV3 ?? {
    byConnection: new Map(),
    bytes: 0,
    entryCount: 0,
    nextExpiresAt: undefined,
  };

globalState.__vedaMailSendIdempotencyV3 = state;
Reflect.deleteProperty(globalState, "__vedaMailSendIdempotency");
Reflect.deleteProperty(globalState, "__vedaMailSendIdempotencyV2");

const orphan = (bucket: SendBucket): void => {
  for (const entry of bucket.entries.values()) {
    if (entry.state === "pending") entry.resolve({ kind: "orphaned" });
  }
};

const subtractEntry = (entry: SendEntry): void => {
  state.bytes -= entry.bytes;
  state.entryCount -= 1;
};

const scheduleExpiry = (expiresAt: number): void => {
  state.nextExpiresAt = Math.min(
    state.nextExpiresAt ?? Number.POSITIVE_INFINITY,
    expiresAt,
  );
};

const pruneExpired = (now: number): void => {
  if (state.nextExpiresAt !== undefined && state.nextExpiresAt > now) return;
  let nextExpiresAt: number | undefined;
  for (const [connectionId, bucket] of state.byConnection) {
    for (const [draftId, entry] of bucket.entries) {
      if (entry.expiresAt > now) {
        nextExpiresAt = Math.min(
          nextExpiresAt ?? Number.POSITIVE_INFINITY,
          entry.expiresAt,
        );
        continue;
      }
      bucket.entries.delete(draftId);
      subtractEntry(entry);
      if (entry.state === "pending") entry.resolve({ kind: "orphaned" });
    }
    if (bucket.entries.size === 0) {
      state.byConnection.delete(connectionId);
    }
  }
  state.nextExpiresAt = nextExpiresAt;
};

const entryFor = (
  connectionId: ConnectionId,
  draftId: DraftId,
  token: string,
): PendingSendEntry | null => {
  const entry = state.byConnection.get(connectionId)?.entries.get(draftId);
  return entry?.state === "pending" && entry.token === token ? entry : null;
};

export const sendIdempotencyStore = {
  begin(
    connectionId: ConnectionId,
    draftId: DraftId,
    fingerprint: string,
    requestedExpiresAt: number,
  ): SendIdempotencyBegin {
    const now = Date.now();
    pruneExpired(now);
    const connectionExpiresAt = boundedConnectionExpiry(
      requestedExpiresAt,
      now,
    );
    if (
      connectionExpiresAt <= now ||
      !validSendFingerprint(fingerprint)
    ) {
      return { kind: "capacity" };
    }
    const existingBucket = state.byConnection.get(connectionId);
    const existing = existingBucket?.entries.get(draftId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) return { kind: "conflict" };
      return existing.state === "completed"
        ? { kind: "replay", receipt: cloneSendReceipt(existing.receipt) }
        : { kind: "pending", outcome: existing.outcome };
    }
    const connectionBytes = bucketBytes(existingBucket);
    const connectionPendingBytes = pendingBytes(existingBucket);
    if (
      (!existingBucket &&
        state.byConnection.size >= MAX_SEND_IDEMPOTENCY_CONNECTIONS) ||
      (existingBucket?.entries.size ?? 0) >=
        MAX_SEND_IDEMPOTENCY_PER_CONNECTION ||
      state.entryCount >= MAX_SEND_IDEMPOTENCY_GLOBAL ||
      pendingCount(existingBucket) >=
        MAX_SEND_IDEMPOTENCY_PENDING_PER_CONNECTION ||
      connectionPendingBytes + SEND_IDEMPOTENCY_PENDING_BYTES >
        MAX_SEND_IDEMPOTENCY_PENDING_BYTES_PER_CONNECTION ||
      connectionBytes + SEND_IDEMPOTENCY_PENDING_BYTES >
        MAX_SEND_IDEMPOTENCY_BYTES_PER_CONNECTION ||
      state.bytes + SEND_IDEMPOTENCY_PENDING_BYTES >
        MAX_SEND_IDEMPOTENCY_BYTES
    ) {
      return { kind: "capacity" };
    }
    const deferred = Promise.withResolvers<SendIdempotencyOutcome>();
    const token = crypto.randomUUID();
    const bucket =
      existingBucket ??
      ({
        entries: new Map<DraftId, SendEntry>(),
      } satisfies SendBucket);
    bucket.entries.set(draftId, {
      bytes: SEND_IDEMPOTENCY_PENDING_BYTES,
      connectionExpiresAt,
      expiresAt: connectionExpiresAt,
      fingerprint,
      outcome: deferred.promise,
      resolve: deferred.resolve,
      state: "pending",
      token,
    });
    state.byConnection.set(connectionId, bucket);
    state.bytes += SEND_IDEMPOTENCY_PENDING_BYTES;
    state.entryCount += 1;
    scheduleExpiry(connectionExpiresAt);
    return { kind: "owner", token };
  },

  clear(connectionId: ConnectionId): void {
    const bucket = state.byConnection.get(connectionId);
    if (!bucket) return;
    state.byConnection.delete(connectionId);
    for (const entry of bucket.entries.values()) subtractEntry(entry);
    orphan(bucket);
  },

  clearAll(): void {
    for (const bucket of state.byConnection.values()) orphan(bucket);
    state.byConnection.clear();
    state.bytes = 0;
    state.entryCount = 0;
    state.nextExpiresAt = undefined;
  },

  complete(
    connectionId: ConnectionId,
    draftId: DraftId,
    token: string,
    receipt: SendReceipt,
  ): SendReceipt | null {
    pruneExpired(Date.now());
    const pending = entryFor(connectionId, draftId, token);
    const bucket = state.byConnection.get(connectionId);
    if (!pending || !bucket) return null;
    const stored = reservedSendReceipt(receipt, pending.bytes);
    state.bytes += stored.bytes - pending.bytes;
    const expiresAt = Math.min(
      pending.connectionExpiresAt,
      Date.now() + SEND_IDEMPOTENCY_TTL_MS,
    );
    bucket.entries.set(draftId, {
      bytes: stored.bytes,
      expiresAt,
      fingerprint: pending.fingerprint,
      receipt: stored.receipt,
      state: "completed",
    });
    scheduleExpiry(expiresAt);
    pending.resolve({
      kind: "completed",
      receipt: cloneSendReceipt(stored.receipt),
    });
    return cloneSendReceipt(stored.receipt);
  },

  fail(
    connectionId: ConnectionId,
    draftId: DraftId,
    token: string,
    error: unknown,
  ): boolean {
    pruneExpired(Date.now());
    const pending = entryFor(connectionId, draftId, token);
    const bucket = state.byConnection.get(connectionId);
    if (!pending || !bucket) return false;
    bucket.entries.delete(draftId);
    subtractEntry(pending);
    if (bucket.entries.size === 0) state.byConnection.delete(connectionId);
    pending.resolve({ error, kind: "failed" });
    return true;
  },
};
