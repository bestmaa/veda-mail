import "server-only";

import type { SendReceipt } from "@/domain/mail/mail";
import type { ConnectionId } from "@/domain/shared/brand";
import {
  type DeliveryNoticeBucket,
  enforceDeliveryNoticeBudget,
} from "@/server/mail/delivery-notice-budget";
import {
  DELIVERY_NOTICE_TTL_MS,
  MAX_DELIVERY_NOTICE_BYTES,
  MAX_DELIVERY_NOTICE_CONNECTIONS,
  MAX_DELIVERY_NOTICES,
  MAX_DELIVERY_NOTICES_GLOBAL,
} from "@/server/mail/delivery-notice-store";
import {
  asOverflowNotice,
  cloneDeliveryNotice,
  noticeFromReceipt,
  type StoredDeliveryNotice,
} from "@/server/mail/delivery-notice-record";
import {
  decryptSharedDeliveryNoticeBucket,
  encryptSharedDeliveryNoticeBucket,
  type SharedDeliveryNoticeBucket,
  sharedDeliveryNoticeConnectionKey,
} from "@/server/mail/shared-delivery-notice-crypto";
import { sharedJobRepository } from
  "@/server/shared-state/shared-job-repository";

const kind = "delivery-notice" as const;
const boundedExpiry = (requestedExpiresAt: number | undefined, now: number): number => {
  const expiresAt = requestedExpiresAt ?? now + DELIVERY_NOTICE_TTL_MS;
  if (!Number.isFinite(expiresAt)) {
    throw new TypeError("Delivery notice expiry is invalid.");
  }
  return Math.min(expiresAt, now + DELIVERY_NOTICE_TTL_MS);
};
const comparable = (bucket: DeliveryNoticeBucket | undefined): string | null =>
  bucket ? JSON.stringify(bucket) : null;
const withVersion = (bucket: DeliveryNoticeBucket): SharedDeliveryNoticeBucket => ({
  ...bucket,
  version: 1,
});
const write = async (
  connectionKey: string,
  bucket: DeliveryNoticeBucket | undefined,
): Promise<void> => {
  await sharedJobRepository.replace(
    kind,
    connectionKey,
    bucket
      ? encryptSharedDeliveryNoticeBucket(connectionKey, withVersion(bucket))
      : null,
    bucket?.expiresAt,
  );
};
const readAll = async (now: number): Promise<Map<string, DeliveryNoticeBucket>> => {
  const records = await sharedJobRepository.list(kind);
  const buckets = new Map<string, DeliveryNoticeBucket>();
  for (const [connectionKey, serialized] of records) {
    const bucket = decryptSharedDeliveryNoticeBucket(connectionKey, serialized);
    if (bucket.expiresAt <= now) await write(connectionKey, undefined);
    else buckets.set(connectionKey, bucket);
  }
  return buckets;
};
const persistChanges = async (
  before: ReadonlyMap<string, DeliveryNoticeBucket>,
  after: ReadonlyMap<string, DeliveryNoticeBucket>,
): Promise<void> => {
  const keys = new Set([...before.keys(), ...after.keys()]);
  const changes: {
    expiresAt?: number;
    owner: string;
    serialized: string | null;
  }[] = [];
  for (const connectionKey of keys) {
    const previous = before.get(connectionKey);
    const current = after.get(connectionKey);
    if (comparable(previous) !== comparable(current)) {
      changes.push({
        owner: connectionKey,
        serialized: current
          ? encryptSharedDeliveryNoticeBucket(connectionKey, withVersion(current))
          : null,
        ...(current ? { expiresAt: current.expiresAt } : {}),
      });
    }
  }
  await sharedJobRepository.replaceMany(kind, changes);
};
const nextSequence = (buckets: ReadonlyMap<string, DeliveryNoticeBucket>): number =>
  Math.max(0, ...[...buckets.values()].map(({ sequence }) => sequence)) + 1;

export const sharedDeliveryNoticeStore = {
  async append(
    connectionId: ConnectionId,
    receipt: SendReceipt,
    requestedExpiresAt?: number,
  ): Promise<boolean> {
    return sharedJobRepository.withLock(kind, async () => {
      const now = Date.now();
      const expiresAt = boundedExpiry(requestedExpiresAt, now);
      if (expiresAt <= now) return true;
      const notice = noticeFromReceipt(receipt);
      if (!notice) return true;
      const before = await readAll(now);
      const buckets = new Map(before);
      const connectionKey = sharedDeliveryNoticeConnectionKey(connectionId);
      const existing = buckets.get(connectionKey);
      if (!existing && buckets.size >= MAX_DELIVERY_NOTICE_CONNECTIONS) return false;
      const bucketExpiry = existing
        ? Math.min(existing.expiresAt, expiresAt)
        : expiresAt;
      const current = (existing?.notices ?? []).slice(0, MAX_DELIVERY_NOTICES);
      if (current.some((item) =>
        item.deliveryNoticeId === notice.deliveryNoticeId)) {
        if (existing && existing.expiresAt !== bucketExpiry) {
          buckets.set(connectionKey, { ...existing, expiresAt: bucketExpiry });
        }
        await persistChanges(before, buckets);
        return true;
      }
      let notices: readonly StoredDeliveryNotice[];
      if (current.length < MAX_DELIVERY_NOTICES) notices = [...current, notice];
      else if (current.some(({ kind: noticeKind }) => noticeKind === "overflow")) {
        notices = current;
      } else {
        notices = [...current.slice(0, -1), asOverflowNotice(notice)];
      }
      buckets.set(connectionKey, {
        expiresAt: bucketExpiry,
        notices,
        sequence: nextSequence(buckets),
      });
      enforceDeliveryNoticeBudget(
        buckets,
        MAX_DELIVERY_NOTICES_GLOBAL,
        MAX_DELIVERY_NOTICE_BYTES,
      );
      await persistChanges(before, buckets);
      return true;
    });
  },

  async clear(connectionId: ConnectionId): Promise<void> {
    await sharedJobRepository.withLock(kind, () =>
      write(sharedDeliveryNoticeConnectionKey(connectionId), undefined));
  },

  async dismiss(
    connectionId: ConnectionId,
    deliveryNoticeId: string,
  ): Promise<void> {
    await sharedJobRepository.withLock(kind, async () => {
      const now = Date.now();
      const before = await readAll(now);
      const buckets = new Map(before);
      const connectionKey = sharedDeliveryNoticeConnectionKey(connectionId);
      const current = buckets.get(connectionKey);
      if (!current) return;
      const retained = current.notices.filter((notice) =>
        notice.deliveryNoticeId !== deliveryNoticeId);
      if (retained.length === 0) buckets.delete(connectionKey);
      else buckets.set(connectionKey, {
        ...current,
        notices: retained,
        sequence: nextSequence(buckets),
      });
      await persistChanges(before, buckets);
    });
  },

  async list(connectionId: ConnectionId): Promise<readonly StoredDeliveryNotice[]> {
    return sharedJobRepository.withLock(kind, async () => {
      const now = Date.now();
      const before = await readAll(now);
      const buckets = new Map(before);
      const connectionKey = sharedDeliveryNoticeConnectionKey(connectionId);
      const bucket = buckets.get(connectionKey);
      if (!bucket) return [];
      buckets.set(connectionKey, { ...bucket, sequence: nextSequence(buckets) });
      await persistChanges(before, buckets);
      return bucket.notices.map(cloneDeliveryNotice);
    });
  },
};
