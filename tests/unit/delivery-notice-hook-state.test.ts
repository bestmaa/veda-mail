import { describe, expect, it } from "vitest";

import {
  dismissDeliveryNotice,
  mergeDeliveryNotices,
  type DeliveryNotice,
} from "@/presentation/features/mail-workspace/partial-delivery-notice";

const submittedAt = "2026-07-30T12:00:00.000Z";

describe("delivery notice hook state interleavings", () => {
  it("removes the captured notice when hydration prepends an older notice", () => {
    const renderedNotice: DeliveryNotice = {
      deliveryNoticeId: "00000000-0000-4000-8000-000000000002",
      kind: "uncertain",
      submittedAt,
    };
    const hydratedNotice: DeliveryNotice = {
      deliveryNoticeId: "00000000-0000-4000-8000-000000000001",
      kind: "uncertain",
      submittedAt,
    };
    const latestState = mergeDeliveryNotices(
      [hydratedNotice],
      [renderedNotice],
    );

    expect(
      dismissDeliveryNotice(latestState, renderedNotice),
    ).toEqual([hydratedNotice]);
  });

  it("uses object identity for metadata-less local notices", () => {
    const captured: DeliveryNotice = { kind: "overflow" };
    const other: DeliveryNotice = { kind: "overflow" };

    expect(dismissDeliveryNotice([captured], captured)).toEqual([]);
    expect(dismissDeliveryNotice([captured], other)).toEqual([captured]);
  });
});
