import { describe, expect, it } from "vitest";

import type { SendMessageInput } from "@/domain/mail/mail";
import {
  canonicalizeSendReceipt,
  type SendReceiptFallback,
} from "@/domain/mail/send-receipt";
import { id } from "@/domain/shared/brand";

const input: SendMessageInput = {
  bcc: [{ email: "Hidden@Example.com", name: null }],
  body: "Hello",
  cc: [{ email: "Copy@Example.com", name: null }],
  subject: "Receipt",
  to: [{ email: "Primary@Example.com", name: null }],
};

const fallback: SendReceiptFallback = {
  deliveryNoticeId: "11111111-1111-4111-8111-111111111111",
  id: id.message("receipt-local-fallback"),
  submittedAt: "2026-07-30T12:00:00.000Z",
};

const providerReceipt = (overrides: Record<string, unknown> = {}) => ({
  deliveryStatus: "accepted",
  id: "provider-message",
  rejectedRecipients: [],
  submittedAt: "2026-07-30T11:59:00.000Z",
  ...overrides,
});

const expectUncertain = (provider: unknown) => {
  expect(canonicalizeSendReceipt(input, provider, fallback)).toEqual({
    deliveryNoticeId: fallback.deliveryNoticeId,
    deliveryStatus: "uncertain",
    id: fallback.id,
    rejectedRecipients: [],
    submittedAt: fallback.submittedAt,
  });
};

describe("send receipt canonicalization", () => {
  it("accepts only an explicit empty rejected-recipient array", () => {
    expect(canonicalizeSendReceipt(input, providerReceipt(), fallback)).toEqual({
      deliveryStatus: "accepted",
      id: id.message("provider-message"),
      rejectedRecipients: [],
      submittedAt: "2026-07-30T11:59:00.000Z",
    });

    expectUncertain(
      providerReceipt({
        rejectedRecipients: ["Primary@Example.com"],
      }),
    );
  });

  it.each([null, "provider text", 42, [], {}])(
    "maps a non-receipt value to uncertain: %j",
    (provider) => {
      expectUncertain(provider);
    },
  );

  it("returns a canonical strict partial subset in submission order", () => {
    const receipt = canonicalizeSendReceipt(
      input,
      providerReceipt({
        deliveryStatus: "partial",
        rejectedRecipients: [
          "hidden@example.com",
          "COPY@example.com",
          "copy@example.com",
        ],
      }),
      fallback,
    );

    expect(receipt).toEqual({
      deliveryNoticeId: fallback.deliveryNoticeId,
      deliveryStatus: "partial",
      id: id.message("provider-message"),
      rejectedRecipients: ["Copy@Example.com", "Hidden@Example.com"],
      submittedAt: "2026-07-30T11:59:00.000Z",
    });
  });

  it("maps empty and all-submitted partial results to uncertain", () => {
    expectUncertain(
      providerReceipt({
        deliveryStatus: "partial",
        rejectedRecipients: [],
      }),
    );
    expectUncertain(
      providerReceipt({
        deliveryStatus: "partial",
        rejectedRecipients: [
          "primary@example.com",
          "copy@example.com",
          "hidden@example.com",
        ],
      }),
    );
  });

  it("does not expose unsubmitted or empty rejected values", () => {
    expectUncertain(
      providerReceipt({
        deliveryStatus: "partial",
        rejectedRecipients: ["unsubmitted-secret@example.com"],
      }),
    );
    expectUncertain(
      providerReceipt({
        deliveryStatus: "partial",
        rejectedRecipients: [""],
      }),
    );
  });

  it("rejects oversized recipient arrays and values", () => {
    expectUncertain(
      providerReceipt({
        deliveryStatus: "partial",
        rejectedRecipients: Array.from(
          { length: 101 },
          () => "Hidden@Example.com",
        ),
      }),
    );
    expectUncertain(
      providerReceipt({
        deliveryStatus: "partial",
        rejectedRecipients: ["a".repeat(255)],
      }),
    );
  });

  it("uses local metadata when otherwise-valid provider metadata is unsafe", () => {
    expect(
      canonicalizeSendReceipt(
        input,
        providerReceipt({
          id: `unsafe\r\n${"x".repeat(2_049)}`,
          submittedAt: "not-a-provider-date",
        }),
        fallback,
      ),
    ).toEqual({
      deliveryStatus: "accepted",
      id: fallback.id,
      rejectedRecipients: [],
      submittedAt: fallback.submittedAt,
    });
  });

  it("maps unknown status and malformed rejected arrays to uncertain", () => {
    expectUncertain(providerReceipt({ deliveryStatus: "delivered" }));
    expectUncertain(providerReceipt({ rejectedRecipients: "none" }));
    expectUncertain(
      providerReceipt({
        deliveryStatus: "partial",
        rejectedRecipients: [null],
      }),
    );
  });
});
