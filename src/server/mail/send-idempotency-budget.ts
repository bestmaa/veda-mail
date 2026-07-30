import "server-only";

import { Buffer } from "node:buffer";

import type { SendReceipt } from "@/domain/mail/mail";

export const SEND_IDEMPOTENCY_TTL_MS = 30 * 60 * 1000;
export const MAX_SEND_IDEMPOTENCY_PER_CONNECTION = 900;
export const MAX_SEND_IDEMPOTENCY_CONNECTIONS = 1_024;
export const MAX_SEND_IDEMPOTENCY_GLOBAL = 10_000;
export const MAX_SEND_IDEMPOTENCY_BYTES = 256 * 1024 * 1024;
export const SEND_IDEMPOTENCY_PENDING_BYTES = 512 * 1024;
export const MAX_SEND_IDEMPOTENCY_PENDING_PER_CONNECTION = 64;
export const MAX_SEND_IDEMPOTENCY_PENDING_BYTES_PER_CONNECTION =
  32 * 1024 * 1024;
export const MAX_SEND_IDEMPOTENCY_BYTES_PER_CONNECTION = 48 * 1024 * 1024;

const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/u;

interface ByteTrackedEntry {
  readonly bytes: number;
  readonly state: "completed" | "pending";
}

export interface ByteTrackedBucket {
  readonly entries: ReadonlyMap<unknown, ByteTrackedEntry>;
}

export const bucketBytes = (
  bucket: ByteTrackedBucket | undefined,
): number => {
  let bytes = 0;
  for (const entry of bucket?.entries.values() ?? []) bytes += entry.bytes;
  return bytes;
};

export const boundedConnectionExpiry = (
  requestedExpiresAt: number,
  now: number,
): number => {
  if (!Number.isFinite(requestedExpiresAt)) {
    throw new TypeError("Send idempotency expiry is invalid.");
  }
  return Math.min(requestedExpiresAt, now + 12 * 60 * 60 * 1000);
};

export const globalEntryCount = (
  buckets: Iterable<ByteTrackedBucket>,
): number => {
  let count = 0;
  for (const bucket of buckets) count += bucket.entries.size;
  return count;
};

export const globalBytes = (
  buckets: Iterable<ByteTrackedBucket>,
): number => {
  let bytes = 0;
  for (const bucket of buckets) bytes += bucketBytes(bucket);
  return bytes;
};

export const pendingCount = (
  bucket: ByteTrackedBucket | undefined,
): number => {
  let count = 0;
  for (const entry of bucket?.entries.values() ?? []) {
    if (entry.state === "pending") count += 1;
  }
  return count;
};

export const pendingBytes = (
  bucket: ByteTrackedBucket | undefined,
): number => {
  let bytes = 0;
  for (const entry of bucket?.entries.values() ?? []) {
    if (entry.state === "pending") bytes += entry.bytes;
  }
  return bytes;
};

export const completedReceiptBytes = (receipt: SendReceipt): number => {
  const json = JSON.stringify(receipt);
  return 1_024 + Math.max(Buffer.byteLength(json, "utf8"), json.length * 2);
};

export const validSendFingerprint = (fingerprint: string): boolean =>
  FINGERPRINT_PATTERN.test(fingerprint);
