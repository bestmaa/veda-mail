import "server-only";

import type { SendReceipt } from "@/domain/mail/mail";
import type { ConnectionId } from "@/domain/shared/brand";
import {
  type DeliveryNoticeBucket,
  enforceDeliveryNoticeBudget,
} from "@/server/mail/delivery-notice-budget";
import {
  asOverflowNotice,
  cloneDeliveryNotice,
  noticeFromReceipt,
  type StoredDeliveryNotice,
} from "@/server/mail/delivery-notice-record";

export {
  DELIVERY_NOTICE_OVERFLOW_MESSAGE,
  type StoredDeliveryNotice,
} from "@/server/mail/delivery-notice-record";

export const MAX_DELIVERY_NOTICES = 100;
export const DELIVERY_NOTICE_TTL_MS = 12 * 60 * 60 * 1000;
export const MAX_DELIVERY_NOTICE_CONNECTIONS = 128;
export const MAX_DELIVERY_NOTICES_GLOBAL = 2_000;
export const MAX_DELIVERY_NOTICE_BYTES = 8 * 1024 * 1024;

interface DeliveryNoticeState {
  readonly byConnection: Map<ConnectionId, DeliveryNoticeBucket>;
  nextSequence: number;
}

const globalState = globalThis as typeof globalThis & {
  __vedaMailDeliveryNoticeBucketsV2?: DeliveryNoticeState;
  __vedaMailDeliveryNotices?: unknown;
};

const state: DeliveryNoticeState =
  globalState.__vedaMailDeliveryNoticeBucketsV2 ?? {
    byConnection: new Map(),
    nextSequence: 0,
  };

globalState.__vedaMailDeliveryNoticeBucketsV2 = state;
Reflect.deleteProperty(globalState, "__vedaMailDeliveryNotices");

const pruneExpiredNotices = (now: number): void => {
  for (const [connectionId, bucket] of state.byConnection) {
    if (bucket.expiresAt <= now) {
      state.byConnection.delete(connectionId);
    }
  }
};

const boundedExpiry = (
  requestedExpiresAt: number | undefined,
  now: number,
): number => {
  const expiresAt = requestedExpiresAt ?? now + DELIVERY_NOTICE_TTL_MS;
  if (!Number.isFinite(expiresAt)) {
    throw new TypeError("Delivery notice expiry is invalid.");
  }
  return Math.min(expiresAt, now + DELIVERY_NOTICE_TTL_MS);
};

const nextSequence = (): number => {
  state.nextSequence += 1;
  return state.nextSequence;
};

export const deliveryNoticeStore = {
  append(
    connectionId: ConnectionId,
    receipt: SendReceipt,
    requestedExpiresAt?: number,
  ): boolean {
    const now = Date.now();
    pruneExpiredNotices(now);
    const expiresAt = boundedExpiry(requestedExpiresAt, now);
    if (expiresAt <= now) return true;
    const notice = noticeFromReceipt(receipt);
    if (!notice) return true;
    const existing = state.byConnection.get(connectionId);
    if (!existing && state.byConnection.size >= MAX_DELIVERY_NOTICE_CONNECTIONS) {
      return false;
    }
    const bucketExpiry = existing
      ? Math.min(existing.expiresAt, expiresAt)
      : expiresAt;
    const current = (existing?.notices ?? []).slice(0, MAX_DELIVERY_NOTICES);
    const store = (notices: readonly StoredDeliveryNotice[]): void => {
      state.byConnection.set(connectionId, {
        expiresAt: bucketExpiry,
        notices,
        sequence: nextSequence(),
      });
      enforceDeliveryNoticeBudget(
        state.byConnection,
        MAX_DELIVERY_NOTICES_GLOBAL,
        MAX_DELIVERY_NOTICE_BYTES,
      );
    };
    if (
      current.some(
        ({ deliveryNoticeId }) =>
          deliveryNoticeId === notice.deliveryNoticeId,
      )
    ) {
      if (existing && existing.expiresAt !== bucketExpiry) {
        state.byConnection.set(connectionId, {
          ...existing,
          expiresAt: bucketExpiry,
        });
      }
      return true;
    }
    if (current.length < MAX_DELIVERY_NOTICES) {
      store([...current, notice]);
      return true;
    }
    if (current.some(({ kind }) => kind === "overflow")) {
      store(current);
      return true;
    }
    store([
      ...current.slice(0, -1),
      asOverflowNotice(notice),
    ]);
    return true;
  },

  clear(connectionId: ConnectionId): void {
    state.byConnection.delete(connectionId);
  },

  clearAll(): void {
    state.byConnection.clear();
    state.nextSequence = 0;
  },

  dismiss(connectionId: ConnectionId, deliveryNoticeId: string): void {
    pruneExpiredNotices(Date.now());
    const current = state.byConnection.get(connectionId);
    if (!current) return;
    const retained = current.notices.filter(
      (notice) => notice.deliveryNoticeId !== deliveryNoticeId,
    );
    if (retained.length === 0) {
      state.byConnection.delete(connectionId);
      return;
    }
    if (retained.length !== current.notices.length) {
      state.byConnection.set(connectionId, {
        ...current,
        notices: retained,
        sequence: nextSequence(),
      });
      return;
    }
    state.byConnection.set(connectionId, {
      ...current,
      sequence: nextSequence(),
    });
  },

  list(connectionId: ConnectionId): readonly StoredDeliveryNotice[] {
    pruneExpiredNotices(Date.now());
    const bucket = state.byConnection.get(connectionId);
    if (!bucket) return [];
    state.byConnection.set(connectionId, {
      ...bucket,
      sequence: nextSequence(),
    });
    return bucket.notices.map(cloneDeliveryNotice);
  },
};
