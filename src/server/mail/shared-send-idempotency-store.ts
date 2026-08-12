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
import { cloneSendReceipt, reservedSendReceipt } from
  "@/server/mail/send-idempotency-receipt";
import type { SendIdempotencyBegin, SendIdempotencyOutcome } from
  "@/server/mail/send-idempotency-types";
import {
  decryptSharedSendBucket,
  encryptSharedSendBucket,
  type SharedSendBucket,
  sharedSendConnectionKey,
} from "@/server/mail/shared-send-idempotency-crypto";
import { sharedJobRepository } from "@/server/shared-state/shared-job-repository";

const POLL_INTERVAL_MS = 250;
const POLL_TIMEOUT_MS = 30_000;
const emptyBucket = (): SharedSendBucket => ({ entries: [], version: 1 });
const pause = () => new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
const liveEntries = (bucket: SharedSendBucket, now: number): SharedSendBucket => ({
  entries: bucket.entries.filter(({ expiresAt }) => expiresAt > now), version: 1,
});
const expiresAt = (bucket: SharedSendBucket): number =>
  Math.max(...bucket.entries.map((entry) => entry.expiresAt));

const read = async (connectionKey: string): Promise<SharedSendBucket> => {
  const serialized = await sharedJobRepository.get("send-idempotency", connectionKey);
  return serialized ? decryptSharedSendBucket(connectionKey, serialized) : emptyBucket();
};
const write = async (connectionKey: string, bucket: SharedSendBucket): Promise<void> => {
  await sharedJobRepository.replace("send-idempotency", connectionKey,
    bucket.entries.length === 0 ? null : encryptSharedSendBucket(connectionKey, bucket),
    bucket.entries.length === 0 ? undefined : expiresAt(bucket));
};

const waitForOutcome = async (
  connectionKey: string,
  draftId: DraftId,
  fingerprint: string,
): Promise<SendIdempotencyOutcome> => {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const entry = (await read(connectionKey)).entries.find((item) => item.draftId === draftId);
    if (!entry || entry.fingerprint !== fingerprint) return { kind: "orphaned" };
    if (entry.state === "completed") {
      return { kind: "completed", receipt: cloneSendReceipt(entry.receipt) };
    }
    await pause();
  }
  return { kind: "in-progress" };
};

const pruneAll = async (now: number): Promise<readonly SharedSendBucket[]> => {
  const records = await sharedJobRepository.list("send-idempotency");
  const buckets: SharedSendBucket[] = [];
  for (const [connectionKey, serialized] of records) {
    const current = decryptSharedSendBucket(connectionKey, serialized);
    const live = liveEntries(current, now);
    if (live.entries.length !== current.entries.length) await write(connectionKey, live);
    if (live.entries.length > 0) buckets.push(live);
  }
  return buckets;
};

export const sharedSendIdempotencyStore = {
  async begin(connectionId: ConnectionId, draftId: DraftId, fingerprint: string,
    requestedExpiresAt: number): Promise<SendIdempotencyBegin> {
    const connectionKey = sharedSendConnectionKey(connectionId);
    return sharedJobRepository.withLock("send-idempotency", async () => {
      const now = Date.now();
      const connectionExpiresAt = boundedConnectionExpiry(requestedExpiresAt, now);
      if (connectionExpiresAt <= now || !validSendFingerprint(fingerprint)) {
        return { kind: "capacity" };
      }
      const allBuckets = await pruneAll(now);
      const bucket = liveEntries(await read(connectionKey), now);
      const existing = bucket.entries.find((entry) => entry.draftId === draftId);
      if (existing) {
        if (existing.fingerprint !== fingerprint) return { kind: "conflict" };
        if (existing.state === "completed") {
          return { kind: "replay", receipt: cloneSendReceipt(existing.receipt) };
        }
        return { kind: "pending",
          outcome: waitForOutcome(connectionKey, draftId, fingerprint) };
      }
      const totalEntries = allBuckets.reduce((sum, item) => sum + item.entries.length, 0);
      const totalBytes = allBuckets.reduce((sum, item) => sum + bucketBytes({
        entries: new Map(item.entries.map((entry) => [entry.draftId, entry])),
      }), 0);
      const mapBucket = { entries: new Map(bucket.entries.map((entry) =>
        [entry.draftId, entry])) };
      if ((bucket.entries.length === 0 && allBuckets.length >= MAX_SEND_IDEMPOTENCY_CONNECTIONS) ||
        bucket.entries.length >= MAX_SEND_IDEMPOTENCY_PER_CONNECTION ||
        totalEntries >= MAX_SEND_IDEMPOTENCY_GLOBAL ||
        pendingCount(mapBucket) >= MAX_SEND_IDEMPOTENCY_PENDING_PER_CONNECTION ||
        pendingBytes(mapBucket) + SEND_IDEMPOTENCY_PENDING_BYTES >
          MAX_SEND_IDEMPOTENCY_PENDING_BYTES_PER_CONNECTION ||
        bucketBytes(mapBucket) + SEND_IDEMPOTENCY_PENDING_BYTES >
          MAX_SEND_IDEMPOTENCY_BYTES_PER_CONNECTION ||
        totalBytes + SEND_IDEMPOTENCY_PENDING_BYTES > MAX_SEND_IDEMPOTENCY_BYTES) {
        return { kind: "capacity" };
      }
      const token = crypto.randomUUID();
      await write(connectionKey, { entries: [...bucket.entries, {
        bytes: SEND_IDEMPOTENCY_PENDING_BYTES, connectionExpiresAt,
        draftId, expiresAt: connectionExpiresAt, fingerprint, state: "pending", token,
      }], version: 1 });
      return { kind: "owner", token };
    });
  },

  async complete(connectionId: ConnectionId, draftId: DraftId, token: string,
    receipt: SendReceipt): Promise<SendReceipt | null> {
    const connectionKey = sharedSendConnectionKey(connectionId);
    return sharedJobRepository.withLock("send-idempotency", async () => {
      const bucket = liveEntries(await read(connectionKey), Date.now());
      const pending = bucket.entries.find((entry) => entry.draftId === draftId &&
        entry.state === "pending" && entry.token === token);
      if (!pending || pending.state !== "pending") return null;
      const stored = reservedSendReceipt(receipt, pending.bytes);
      const expiry = Math.min(pending.connectionExpiresAt,
        Date.now() + SEND_IDEMPOTENCY_TTL_MS);
      if (expiry <= Date.now()) {
        await write(connectionKey, { entries: bucket.entries.filter((entry) => entry !== pending),
          version: 1 });
        return null;
      }
      const completed = cloneSendReceipt(stored.receipt);
      await write(connectionKey, { entries: bucket.entries.map((entry) =>
        entry === pending ? { bytes: stored.bytes, draftId, expiresAt: expiry,
          fingerprint: pending.fingerprint, receipt: completed,
          state: "completed" as const } : entry), version: 1 });
      return completed;
    });
  },

  async fail(connectionId: ConnectionId, draftId: DraftId, token: string): Promise<boolean> {
    const connectionKey = sharedSendConnectionKey(connectionId);
    return sharedJobRepository.withLock("send-idempotency", async () => {
      const bucket = liveEntries(await read(connectionKey), Date.now());
      const pending = bucket.entries.find((entry) => entry.draftId === draftId &&
        entry.state === "pending" && entry.token === token);
      if (!pending) return false;
      await write(connectionKey, { entries: bucket.entries.filter((entry) => entry !== pending),
        version: 1 });
      return true;
    });
  },

  async clear(connectionId: ConnectionId): Promise<void> {
    await sharedJobRepository.withLock("send-idempotency", () =>
      write(sharedSendConnectionKey(connectionId), emptyBucket()));
  },
};
