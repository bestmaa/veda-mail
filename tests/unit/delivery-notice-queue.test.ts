import { describe, expect, it } from "vitest";

import {
  applyDeliveryReceipt,
  dismissDeliveryNotice,
  MAX_DELIVERY_NOTICE_QUEUE,
  mergeDeliveryNotices,
  restoreDeliveryNotice,
  type DeliveryNotice,
} from "@/presentation/features/mail-workspace/partial-delivery-notice";

const partial = (rejectedRecipients: unknown) => ({
  deliveryStatus: "partial",
  rejectedRecipients,
});
const accepted = {
  deliveryStatus: "accepted",
  rejectedRecipients: [],
};

describe("delivery notice queue", () => {
  it("keeps unrelated partial notices in FIFO order", () => {
    const first = applyDeliveryReceipt(
      [],
      partial(["first-rejected@example.com"]),
      ["accepted@example.com", "first-rejected@example.com"],
    );
    const second = applyDeliveryReceipt(
      first,
      partial(["second-rejected@example.com"]),
      ["other@example.com", "second-rejected@example.com"],
    );

    expect(second).toEqual([
      {
        kind: "partial",
        rejectedRecipients: ["first-rejected@example.com"],
      },
      {
        kind: "partial",
        rejectedRecipients: ["second-rejected@example.com"],
      },
    ]);
    expect(dismissDeliveryNotice(second)).toEqual([second[1]]);
  });

  it("keeps a notice after accepted sends to the same or other recipients", () => {
    const pending = applyDeliveryReceipt(
      [],
      partial(["Retry@Example.com"]),
      ["accepted@example.com", "Retry@Example.com"],
    );

    expect(
      applyDeliveryReceipt(pending, accepted, ["retry@example.com"]),
    ).toEqual(pending);
    expect(
      applyDeliveryReceipt(pending, accepted, ["unrelated@example.com"]),
    ).toEqual(pending);
  });

  it("upserts a sent notice already present from hydration by opaque id", () => {
    const deliveryNoticeId = "00000000-0000-4000-8000-000000000001";
    const hydrated: readonly DeliveryNotice[] = [
      {
        deliveryNoticeId,
        kind: "partial",
        rejectedRecipients: ["retry@example.com"],
        submittedAt: "2026-07-30T12:00:00.000Z",
      },
    ];
    const afterSend = applyDeliveryReceipt(
      hydrated,
      {
        deliveryNoticeId,
        deliveryStatus: "partial",
        rejectedRecipients: ["RETRY@example.com"],
        submittedAt: "2026-07-30T12:00:00.000Z",
      },
      ["accepted@example.com", "RETRY@example.com"],
    );

    expect(afterSend).toHaveLength(1);
    expect(afterSend[0]).toMatchObject({
      deliveryNoticeId,
      kind: "partial",
      rejectedRecipients: ["RETRY@example.com"],
    });
  });

  it("queues a new partial result even for the same recipient set", () => {
    const pending = applyDeliveryReceipt(
      [],
      partial(["one@example.com", "two@example.com"]),
      ["accepted@example.com", "one@example.com", "two@example.com"],
    );

    expect(
      applyDeliveryReceipt(
        pending,
        partial(["two@example.com"]),
        ["one@example.com", "two@example.com"],
      ),
    ).toEqual([
      {
        kind: "partial",
        rejectedRecipients: ["one@example.com", "two@example.com"],
      },
      {
        kind: "partial",
        rejectedRecipients: ["two@example.com"],
      },
    ]);
  });

  it.each([
    { deliveryStatus: "uncertain", rejectedRecipients: ["evil@example.com"] },
    { deliveryStatus: "partial", rejectedRecipients: null },
    {
      deliveryStatus: "partial",
      rejectedRecipients: ["unsubmitted@example.com"],
    },
    {
      deliveryStatus: "partial",
      rejectedRecipients: ["only@example.com"],
    },
  ])("uses a recipient-free uncertain notice for unsafe receipt %#", (receipt) => {
    const queue = applyDeliveryReceipt(
      [],
      receipt,
      ["only@example.com"],
    );

    expect(queue).toEqual([{ kind: "uncertain" }]);
    expect(queue[0]).not.toHaveProperty("rejectedRecipients");
  });

  it("replaces the final slot with one overflow sentinel at capacity", () => {
    const fullQueue: readonly DeliveryNotice[] = Array.from(
      { length: MAX_DELIVERY_NOTICE_QUEUE },
      () => ({ kind: "uncertain" }),
    );
    const overflowed = applyDeliveryReceipt(
      fullQueue,
      { deliveryStatus: "uncertain" },
      [],
    );

    expect(overflowed).toHaveLength(MAX_DELIVERY_NOTICE_QUEUE);
    expect(overflowed.at(-1)).toEqual({ kind: "overflow" });
    expect(overflowed.filter(({ kind }) => kind === "overflow")).toHaveLength(1);
    expect(
      applyDeliveryReceipt(
        overflowed,
        { deliveryStatus: "uncertain" },
        [],
      ),
    ).toEqual(overflowed);
  });

  it("carries the persisted incoming id onto a capacity overflow sentinel", () => {
    const fullQueue: readonly DeliveryNotice[] = Array.from(
      { length: MAX_DELIVERY_NOTICE_QUEUE },
      () => ({ kind: "uncertain" }),
    );
    const deliveryNoticeId = "00000000-0000-4000-8000-000000000101";
    const submittedAt = "2026-07-30T12:00:00.000Z";
    const overflowed = applyDeliveryReceipt(
      fullQueue,
      {
        deliveryNoticeId,
        deliveryStatus: "uncertain",
        submittedAt,
      },
      [],
    );

    expect(overflowed.at(-1)).toEqual({
      deliveryNoticeId,
      kind: "overflow",
      submittedAt,
    });
    expect(
      mergeDeliveryNotices(overflowed, [
        { deliveryNoticeId, kind: "overflow", submittedAt },
      ]),
    ).toHaveLength(MAX_DELIVERY_NOTICE_QUEUE);
  });

  it("restores a failed optimistic dismissal at the FIFO front once", () => {
    const dismissed: DeliveryNotice = {
      deliveryNoticeId: "00000000-0000-4000-8000-000000000001",
      kind: "uncertain",
      submittedAt: "2026-07-30T12:00:00.000Z",
    };
    const remaining: readonly DeliveryNotice[] = [
      {
        deliveryNoticeId: "00000000-0000-4000-8000-000000000002",
        kind: "uncertain",
        submittedAt: "2026-07-30T12:01:00.000Z",
      },
    ];

    expect(
      restoreDeliveryNotice(
        mergeDeliveryNotices(remaining, [dismissed]),
        dismissed,
      ),
    ).toEqual([dismissed, remaining[0]]);
  });
});
