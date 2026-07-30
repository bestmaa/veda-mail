import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SendReceipt } from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import { connectionStore } from "@/server/connections/connection-store";
import {
  DELIVERY_NOTICE_OVERFLOW_MESSAGE,
  deliveryNoticeStore,
  MAX_DELIVERY_NOTICES,
} from "@/server/mail/delivery-notice-store";

const connectionA = id.connection("delivery-notice-connection-a");
const connectionB = id.connection("delivery-notice-connection-b");

const noticeId = (index: number): string =>
  `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;

const receipt = (
  index: number,
  deliveryStatus: "partial" | "uncertain" = "uncertain",
): SendReceipt => ({
  deliveryNoticeId: noticeId(index),
  deliveryStatus,
  id: id.message(`message-${index}`),
  rejectedRecipients:
    deliveryStatus === "partial" ? [`Rejected-${index}@Example.com`] : [],
  submittedAt: new Date(Date.UTC(2026, 6, 30, 0, 0, index)).toISOString(),
});

beforeEach(() => {
  connectionStore.clearAll();
  deliveryNoticeStore.clearAll();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("delivery notice store", () => {
  it("keeps canonical notices isolated and in FIFO order", () => {
    deliveryNoticeStore.append(connectionA, receipt(1, "partial"));
    deliveryNoticeStore.append(connectionA, receipt(2));
    deliveryNoticeStore.append(connectionB, receipt(3, "partial"));

    expect(deliveryNoticeStore.list(connectionA)).toEqual([
      {
        deliveryNoticeId: noticeId(1),
        kind: "partial",
        rejectedRecipients: ["Rejected-1@Example.com"],
        submittedAt: "2026-07-30T00:00:01.000Z",
      },
      {
        deliveryNoticeId: noticeId(2),
        kind: "uncertain",
        submittedAt: "2026-07-30T00:00:02.000Z",
      },
    ]);
    expect(deliveryNoticeStore.list(connectionB)).toEqual([
      {
        deliveryNoticeId: noticeId(3),
        kind: "partial",
        rejectedRecipients: ["Rejected-3@Example.com"],
        submittedAt: "2026-07-30T00:00:03.000Z",
      },
    ]);
  });

  it("defensively copies recipient details and ignores accepted receipts", () => {
    deliveryNoticeStore.append(connectionA, {
      ...receipt(1, "partial"),
      deliveryStatus: "accepted",
      rejectedRecipients: [],
    });
    deliveryNoticeStore.append(connectionA, receipt(2, "partial"));

    const listed = deliveryNoticeStore.list(connectionA);
    const recipients = listed[0]?.kind === "partial"
      ? listed[0].rejectedRecipients
      : [];
    (recipients as string[]).push("mutated@example.com");

    expect(deliveryNoticeStore.list(connectionA)).toEqual([
      {
        deliveryNoticeId: noticeId(2),
        kind: "partial",
        rejectedRecipients: ["Rejected-2@Example.com"],
        submittedAt: "2026-07-30T00:00:02.000Z",
      },
    ]);
  });

  it("replaces the final slot with one explicit overflow sentinel", () => {
    for (let index = 0; index < MAX_DELIVERY_NOTICES; index += 1) {
      deliveryNoticeStore.append(connectionA, receipt(index));
    }

    deliveryNoticeStore.append(
      connectionA,
      receipt(MAX_DELIVERY_NOTICES),
    );
    const overflowed = deliveryNoticeStore.list(connectionA);

    expect(overflowed).toHaveLength(MAX_DELIVERY_NOTICES);
    expect(overflowed.at(-1)).toEqual({
      deliveryNoticeId: noticeId(MAX_DELIVERY_NOTICES),
      kind: "overflow",
      message: DELIVERY_NOTICE_OVERFLOW_MESSAGE,
      submittedAt: "2026-07-30T00:01:40.000Z",
    });
    expect(overflowed.filter(({ kind }) => kind === "overflow")).toHaveLength(1);

    deliveryNoticeStore.append(
      connectionA,
      receipt(MAX_DELIVERY_NOTICES + 1),
    );
    expect(deliveryNoticeStore.list(connectionA)).toEqual(overflowed);
  });

  it("dismisses by UUID without revealing whether the notice existed", () => {
    deliveryNoticeStore.append(connectionA, receipt(1));
    deliveryNoticeStore.append(connectionA, receipt(2));

    deliveryNoticeStore.dismiss(connectionA, noticeId(1));
    deliveryNoticeStore.dismiss(connectionA, noticeId(1));
    deliveryNoticeStore.dismiss(connectionB, noticeId(2));

    expect(deliveryNoticeStore.list(connectionA)).toEqual([
      {
        deliveryNoticeId: noticeId(2),
        kind: "uncertain",
        submittedAt: "2026-07-30T00:00:02.000Z",
      },
    ]);
    expect(deliveryNoticeStore.list(connectionB)).toEqual([]);
  });

  it("deduplicates UUIDs without changing FIFO order", () => {
    deliveryNoticeStore.append(connectionA, receipt(1));
    deliveryNoticeStore.append(connectionA, receipt(1));
    deliveryNoticeStore.append(connectionA, receipt(2));

    expect(
      deliveryNoticeStore
        .list(connectionA)
        .map((notice) =>
          "deliveryNoticeId" in notice ? notice.deliveryNoticeId : null,
        ),
    ).toEqual([noticeId(1), noticeId(2)]);
  });

  it("appends after a retained sentinel when dismissal frees capacity", () => {
    for (let index = 0; index < MAX_DELIVERY_NOTICES; index += 1) {
      deliveryNoticeStore.append(connectionA, receipt(index));
    }
    deliveryNoticeStore.append(
      connectionA,
      receipt(MAX_DELIVERY_NOTICES),
    );
    deliveryNoticeStore.dismiss(connectionA, noticeId(0));
    deliveryNoticeStore.append(
      connectionA,
      receipt(MAX_DELIVERY_NOTICES + 1),
    );

    const notices = deliveryNoticeStore.list(connectionA);
    expect(notices).toHaveLength(MAX_DELIVERY_NOTICES);
    expect(notices.at(-2)?.kind).toBe("overflow");
    expect(notices.at(-1)).toEqual({
      deliveryNoticeId: noticeId(MAX_DELIVERY_NOTICES + 1),
      kind: "uncertain",
      submittedAt: "2026-07-30T00:01:41.000Z",
    });
  });

  it("cleans notices when a connection is removed or all are cleared", () => {
    const first = connectionStore.create(
      { config: {}, displayName: "First", providerId: id.provider("mock") },
      "revision",
    );
    const second = connectionStore.create(
      { config: {}, displayName: "Second", providerId: id.provider("mock") },
      "revision",
    );
    deliveryNoticeStore.append(first.id, receipt(1));
    deliveryNoticeStore.append(second.id, receipt(2));

    connectionStore.remove(first.id);
    expect(deliveryNoticeStore.list(first.id)).toEqual([]);
    expect(deliveryNoticeStore.list(second.id)).toHaveLength(1);

    connectionStore.clearAll();
    expect(deliveryNoticeStore.list(second.id)).toEqual([]);
  });

  it("cleans notices when connection pruning detects expiry", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-30T00:00:00.000Z"));
    const connection = connectionStore.create(
      { config: {}, displayName: "Expiring", providerId: id.provider("mock") },
      "revision",
    );
    deliveryNoticeStore.append(connection.id, receipt(1));

    vi.setSystemTime(new Date("2026-07-30T12:00:00.001Z"));
    expect(connectionStore.get(connection.id)).toBeNull();
    expect(deliveryNoticeStore.list(connection.id)).toEqual([]);
  });

  it("defensively sweeps expired orphan buckets on later activity", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-30T00:00:00.000Z"));
    deliveryNoticeStore.append(
      connectionA,
      receipt(1),
      Date.now() + 1_000,
    );

    vi.setSystemTime(new Date("2026-07-30T00:00:01.001Z"));
    deliveryNoticeStore.append(connectionB, receipt(2));

    expect(deliveryNoticeStore.list(connectionA)).toEqual([]);
    expect(deliveryNoticeStore.list(connectionB)).toHaveLength(1);
  });
});
