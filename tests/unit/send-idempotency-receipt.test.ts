import { beforeEach, describe, expect, it } from "vitest";

import type { SendReceipt } from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import {
  completedReceiptBytes,
  SEND_IDEMPOTENCY_PENDING_BYTES,
  sendIdempotencyStore,
} from "@/server/mail/send-idempotency-store";

const connectionId = id.connection("send-receipt-connection");
const fingerprint = "c".repeat(64);
const expiry = (): number => Date.now() + 60 * 60 * 1_000;

const partialReceipt = (): SendReceipt => {
  const domain = `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(52)}`;
  return {
    deliveryNoticeId: "22222222-2222-4222-8222-222222222222",
    deliveryStatus: "partial",
    id: id.message("界".repeat(2_048)),
    rejectedRecipients: Array.from(
      { length: 99 },
      (_, index) => `r${index}@${domain}`,
    ),
    submittedAt: "2026-07-30T12:00:00.000Z",
  };
};

const beginOwner = (draft: string): string => {
  const begun = sendIdempotencyStore.begin(
    connectionId,
    id.draft(draft),
    fingerprint,
    expiry(),
  );
  expect(begun.kind).toBe("owner");
  if (begun.kind !== "owner") throw new Error("Expected send ownership.");
  return begun.token;
};

beforeEach(() => {
  sendIdempotencyStore.clearAll();
});

describe("send idempotency receipt reservation", () => {
  it("fits a worst-bound Unicode partial receipt in the reserved bytes", () => {
    const terminal = partialReceipt();
    expect(completedReceiptBytes(terminal)).toBeLessThan(
      SEND_IDEMPOTENCY_PENDING_BYTES,
    );
    const draft = id.draft("valid-unicode");
    const token = beginOwner(draft);

    expect(() =>
      sendIdempotencyStore.complete(
        connectionId,
        draft,
        token,
        terminal,
      ),
    ).not.toThrow();
    expect(
      sendIdempotencyStore.begin(
        connectionId,
        draft,
        fingerprint,
        expiry(),
      ),
    ).toEqual({ kind: "replay", receipt: terminal });
  });

  it.each([
    {
      label: "oversized",
      receipt: {
        ...partialReceipt(),
        id: id.message("界".repeat(SEND_IDEMPOTENCY_PENDING_BYTES)),
      } satisfies SendReceipt,
    },
    {
      label: "hostile getter",
      receipt: Object.defineProperty(
        {
          ...partialReceipt(),
          rejectedRecipients: [],
        },
        "rejectedRecipients",
        {
          get: () => {
            throw new Error("hostile receipt getter");
          },
        },
      ) as SendReceipt,
    },
  ])(
    "settles owner and waiters as terminal uncertain for a $label receipt",
    async ({ label, receipt }) => {
      const draft = id.draft(`fallback-${label}`);
      const token = beginOwner(draft);
      const pending = sendIdempotencyStore.begin(
        connectionId,
        draft,
        fingerprint,
        expiry(),
      );
      if (pending.kind !== "pending") throw new Error("Expected waiter.");

      let terminal: SendReceipt | null = null;
      expect(() => {
        terminal = sendIdempotencyStore.complete(
          connectionId,
          draft,
          token,
          receipt,
        );
      }).not.toThrow();
      expect(terminal).toMatchObject({
        deliveryStatus: "uncertain",
        rejectedRecipients: [],
      });
      await expect(pending.outcome).resolves.toEqual({
        kind: "completed",
        receipt: terminal,
      });
      expect(
        sendIdempotencyStore.begin(
          connectionId,
          draft,
          fingerprint,
          expiry(),
        ),
      ).toEqual({ kind: "replay", receipt: terminal });
    },
  );
});
