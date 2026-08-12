import "server-only";

import { Buffer } from "node:buffer";

import {
  asOverflowNotice,
  deliveryNoticeBytes,
  type StoredDeliveryNotice,
} from "@/server/mail/delivery-notice-record";

export interface DeliveryNoticeBucket {
  readonly expiresAt: number;
  readonly notices: readonly StoredDeliveryNotice[];
  readonly sequence: number;
}

const BUCKET_OVERHEAD_BYTES = 256;

const bucketBytes = (
  connectionId: string,
  bucket: DeliveryNoticeBucket,
): number =>
  bucket.notices.reduce(
    (total, notice) => total + deliveryNoticeBytes(notice),
    BUCKET_OVERHEAD_BYTES +
      Math.max(
        Buffer.byteLength(connectionId, "utf8"),
        connectionId.length * 2,
      ),
  );

const usage = (
  buckets: ReadonlyMap<string, DeliveryNoticeBucket>,
): { readonly bytes: number; readonly notices: number } => {
  let bytes = 0;
  let notices = 0;
  for (const [connectionId, bucket] of buckets) {
    bytes += bucketBytes(connectionId, bucket);
    notices += bucket.notices.length;
  }
  return { bytes, notices };
};

const oldestConnection = (
  buckets: ReadonlyMap<string, DeliveryNoticeBucket>,
  predicate: (bucket: DeliveryNoticeBucket) => boolean = () => true,
): string | null => {
  let oldest: readonly [string, DeliveryNoticeBucket] | null = null;
  for (const entry of buckets) {
    if (!predicate(entry[1])) continue;
    if (
      !oldest ||
      entry[1].sequence < oldest[1].sequence ||
      (entry[1].sequence === oldest[1].sequence && entry[0] < oldest[0])
    ) {
      oldest = entry;
    }
  }
  return oldest?.[0] ?? null;
};

const compressToOverflow = (
  buckets: Map<string, DeliveryNoticeBucket>,
  connectionId: string,
): void => {
  const bucket = buckets.get(connectionId);
  if (!bucket || bucket.notices.length === 0) return;
  const existing = bucket.notices.find(({ kind }) => kind === "overflow");
  const source = existing ?? bucket.notices.at(-1);
  if (!source) return;
  buckets.set(connectionId, {
    ...bucket,
    notices: [existing ?? asOverflowNotice(source)],
  });
};

export const enforceDeliveryNoticeBudget = (
  buckets: Map<string, DeliveryNoticeBucket>,
  maxNotices: number,
  maxBytes: number,
): void => {
  let current = usage(buckets);
  while (current.notices > maxNotices || current.bytes > maxBytes) {
    const compressible = oldestConnection(
      buckets,
      ({ notices }) =>
        notices.length !== 1 || notices[0]?.kind !== "overflow",
    );
    if (compressible) {
      compressToOverflow(buckets, compressible);
    } else {
      const oldest = oldestConnection(buckets);
      if (!oldest) break;
      buckets.delete(oldest);
    }
    current = usage(buckets);
  }
};
