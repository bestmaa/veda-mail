import { describe, expect, it } from "vitest";

import { parseDeliveryNoticeSnapshot } from "@/presentation/features/mail-workspace/delivery-notice-snapshot";
import { MAX_DELIVERY_NOTICE_QUEUE } from "@/presentation/features/mail-workspace/partial-delivery-notice";

const submittedAt = "2026-07-30T12:00:00.000Z";
const noticeId = (index: number): string =>
  `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

describe("delivery notice snapshot parser", () => {
  it("hydrates trusted FIFO partial, uncertain, and overflow snapshots", () => {
    expect(
      parseDeliveryNoticeSnapshot([
        {
          deliveryNoticeId: noticeId(1),
          kind: "partial",
          rejectedRecipients: ["retry@example.com"],
          submittedAt,
        },
        {
          deliveryNoticeId: noticeId(2),
          kind: "uncertain",
          submittedAt,
        },
        {
          deliveryNoticeId: noticeId(3),
          kind: "overflow",
          message:
            "Additional delivery outcomes require review in Sent or with your mail provider.",
          submittedAt,
        },
      ]),
    ).toEqual([
      {
        deliveryNoticeId: noticeId(1),
        kind: "partial",
        rejectedRecipients: ["retry@example.com"],
        submittedAt,
      },
      {
        deliveryNoticeId: noticeId(2),
        kind: "uncertain",
        submittedAt,
      },
      {
        deliveryNoticeId: noticeId(3),
        kind: "overflow",
        submittedAt,
      },
    ]);
  });

  it("bounds hostile snapshots and degrades unsafe values without exposing them", () => {
    const hostileRecipient = `private-${"x".repeat(1_000)}@example.com`;
    const snapshot = [
      {
        deliveryNoticeId: noticeId(1),
        kind: "partial",
        rejectedRecipients: [hostileRecipient],
        submittedAt,
      },
      ...Array.from(
        { length: MAX_DELIVERY_NOTICE_QUEUE },
        (_, index) => ({
          deliveryNoticeId: noticeId(index + 2),
          kind: "uncertain",
          submittedAt,
        }),
      ),
      {
        deliveryNoticeId: "not-a-uuid",
        kind: "partial",
        rejectedRecipients: ["injected@example.com"],
        submittedAt: "not-a-date",
      },
    ];

    const notices = parseDeliveryNoticeSnapshot(snapshot);

    expect(notices).toHaveLength(MAX_DELIVERY_NOTICE_QUEUE);
    expect(notices.filter(({ kind }) => kind === "overflow")).toHaveLength(1);
    expect(JSON.stringify(notices)).not.toContain(hostileRecipient);
    expect(JSON.stringify(notices)).not.toContain("injected@example.com");
  });

  it("uses a recipient-free warning for malformed envelopes and partials", () => {
    expect(parseDeliveryNoticeSnapshot({ notices: [] })).toEqual([
      { kind: "overflow" },
    ]);
    expect(
      parseDeliveryNoticeSnapshot([
        {
          deliveryNoticeId: noticeId(1),
          kind: "partial",
          rejectedRecipients: ["duplicate@example.com", "DUPLICATE@example.com"],
          submittedAt,
        },
      ]),
    ).toEqual([
      {
        deliveryNoticeId: noticeId(1),
        kind: "uncertain",
        submittedAt,
      },
    ]);
  });
});
