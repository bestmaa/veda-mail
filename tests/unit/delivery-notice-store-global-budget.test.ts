import { beforeEach, describe, expect, it } from "vitest";

import type { SendReceipt } from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import {
  deliveryNoticeStore,
  MAX_DELIVERY_NOTICE_BYTES,
  MAX_DELIVERY_NOTICE_CONNECTIONS,
  MAX_DELIVERY_NOTICES,
  MAX_DELIVERY_NOTICES_GLOBAL,
} from "@/server/mail/delivery-notice-store";
import { deliveryNoticeBytes } from "@/server/mail/delivery-notice-record";

const connection = (index: number) =>
  id.connection(`global-delivery-notice-${index.toString().padStart(4, "0")}`);

const noticeId = (index: number): string =>
  `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;

const uncertainReceipt = (index: number): SendReceipt => ({
  deliveryNoticeId: noticeId(index),
  deliveryStatus: "uncertain",
  id: id.message(`message-${index}`),
  rejectedRecipients: [],
  submittedAt: "2026-07-30T12:00:00.000Z",
});

const largeRecipients = (noticeIndex: number): readonly string[] => {
  const domain = `${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(57)}`;
  return Array.from({ length: 99 }, (_, recipientIndex) => {
    const prefix = `r${noticeIndex}-${recipientIndex}`;
    return `${prefix.padEnd(63, "a")}@${domain}`;
  });
};

const partialReceipt = (index: number): SendReceipt => ({
  ...uncertainReceipt(index),
  deliveryStatus: "partial",
  rejectedRecipients: largeRecipients(index),
});

beforeEach(() => {
  deliveryNoticeStore.clearAll();
});

describe("delivery notice process-wide budgets", () => {
  it("refuses a new bucket at the key cap without erasing prior buckets", () => {
    for (
      let index = 0;
      index < MAX_DELIVERY_NOTICE_CONNECTIONS;
      index += 1
    ) {
      deliveryNoticeStore.append(connection(index), uncertainReceipt(index));
    }
    const admitted = deliveryNoticeStore.append(
      connection(MAX_DELIVERY_NOTICE_CONNECTIONS),
      uncertainReceipt(MAX_DELIVERY_NOTICE_CONNECTIONS),
    );

    expect(admitted).toBe(false);
    expect(
      deliveryNoticeStore.list(
        connection(MAX_DELIVERY_NOTICE_CONNECTIONS),
      ),
    ).toEqual([]);
    for (
      let index = 0;
      index < MAX_DELIVERY_NOTICE_CONNECTIONS;
      index += 1
    ) {
      expect(deliveryNoticeStore.list(connection(index))).toEqual([
        {
          deliveryNoticeId: noticeId(index),
          kind: "uncertain",
          submittedAt: "2026-07-30T12:00:00.000Z",
        },
      ]);
    }

    const updateIndex = MAX_DELIVERY_NOTICE_CONNECTIONS + 1;
    deliveryNoticeStore.append(connection(0), uncertainReceipt(updateIndex));
    expect(
      deliveryNoticeStore
        .list(connection(0))
        .map((notice) =>
          "deliveryNoticeId" in notice ? notice.deliveryNoticeId : null,
        ),
    ).toEqual([noticeId(0), noticeId(updateIndex)]);
  });

  it("accounts for ASCII UTF-16 and Unicode UTF-8 string storage", () => {
    const ascii = "a".repeat(254);
    const unicode = "界".repeat(254);
    const base = {
      deliveryNoticeId: noticeId(42),
      kind: "partial" as const,
      submittedAt: "2026-07-30T12:00:00.000Z",
    };

    expect(
      deliveryNoticeBytes({ ...base, rejectedRecipients: [ascii] }),
    ).toBeGreaterThanOrEqual(ascii.length * 2);
    expect(
      deliveryNoticeBytes({ ...base, rejectedRecipients: [unicode] }),
    ).toBeGreaterThanOrEqual(Buffer.byteLength(unicode, "utf8"));
  });

  it("compresses old buckets to sentinels at the global notice cap", () => {
    const connectionCount =
      Math.ceil(MAX_DELIVERY_NOTICES_GLOBAL / MAX_DELIVERY_NOTICES) + 1;
    let receiptIndex = 0;
    for (
      let connectionIndex = 0;
      connectionIndex < connectionCount;
      connectionIndex += 1
    ) {
      for (
        let noticeIndex = 0;
        noticeIndex < MAX_DELIVERY_NOTICES;
        noticeIndex += 1
      ) {
        deliveryNoticeStore.append(
          connection(connectionIndex),
          uncertainReceipt(receiptIndex),
        );
        receiptIndex += 1;
      }
    }

    const snapshots = Array.from(
      { length: connectionCount },
      (_, index) => deliveryNoticeStore.list(connection(index)),
    );
    expect(snapshots[0]).toHaveLength(1);
    expect(snapshots[0]?.[0]?.kind).toBe("overflow");
    expect(
      snapshots.reduce((total, notices) => total + notices.length, 0),
    ).toBeLessThanOrEqual(MAX_DELIVERY_NOTICES_GLOBAL);
    expect(snapshots.at(-1)).toHaveLength(MAX_DELIVERY_NOTICES);
  }, 15_000);

  it("uses an explicit sentinel when the byte budget drops details", () => {
    expect(MAX_DELIVERY_NOTICE_BYTES).toBeLessThan(
      4 * MAX_DELIVERY_NOTICES * 99 * 249,
    );
    let receiptIndex = 10_000;
    for (let connectionIndex = 0; connectionIndex < 4; connectionIndex += 1) {
      for (
        let noticeIndex = 0;
        noticeIndex < MAX_DELIVERY_NOTICES;
        noticeIndex += 1
      ) {
        deliveryNoticeStore.append(
          connection(connectionIndex),
          partialReceipt(receiptIndex),
        );
        receiptIndex += 1;
      }
    }

    const oldest = deliveryNoticeStore.list(connection(0));
    expect(oldest).toHaveLength(1);
    expect(oldest[0]?.kind).toBe("overflow");
    expect(
      deliveryNoticeStore.list(connection(3)).some(
        ({ kind }) => kind === "partial",
      ),
    ).toBe(true);
  });
});
