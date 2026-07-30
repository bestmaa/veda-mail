import { beforeEach, describe, expect, it } from "vitest";

import type { SendReceipt } from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import {
  completedReceiptBytes,
  MAX_SEND_IDEMPOTENCY_BYTES,
  MAX_SEND_IDEMPOTENCY_BYTES_PER_CONNECTION,
  MAX_SEND_IDEMPOTENCY_PENDING_PER_CONNECTION,
  MAX_SEND_IDEMPOTENCY_PER_CONNECTION,
  SEND_IDEMPOTENCY_PENDING_BYTES,
  sendIdempotencyStore,
} from "@/server/mail/send-idempotency-store";

const connection = (index: number) => id.connection(`capacity-${index}`);
const draft = (index: number) => id.draft(`capacity-draft-${index}`);
const fingerprint = (index: number) =>
  index.toString(16).padStart(64, "0");
const expiry = (): number => Date.now() + 60 * 60 * 1_000;
const acceptedReceipt = (index: number): SendReceipt => ({
  deliveryStatus: "accepted",
  id: id.message(`message-${index}`),
  rejectedRecipients: [],
  submittedAt: "2026-07-30T12:00:00.000Z",
});

const ownerToken = (
  begun: ReturnType<typeof sendIdempotencyStore.begin>,
): string => {
  expect(begun.kind).toBe("owner");
  if (begun.kind !== "owner") throw new Error("Expected send ownership.");
  return begun.token;
};

const complete = (
  connectionIndex: number,
  entryIndex: number,
  receipt: SendReceipt = acceptedReceipt(entryIndex),
): void => {
  const token = ownerToken(
    sendIdempotencyStore.begin(
      connection(connectionIndex),
      draft(entryIndex),
      fingerprint(entryIndex),
      expiry(),
    ),
  );
  sendIdempotencyStore.complete(
    connection(connectionIndex),
    draft(entryIndex),
    token,
    receipt,
  );
};

beforeEach(() => {
  sendIdempotencyStore.clearAll();
});

describe("send idempotency capacity", () => {
  it("fails closed at the per-connection pending cap without blocking another connection", () => {
    for (
      let index = 0;
      index < MAX_SEND_IDEMPOTENCY_PENDING_PER_CONNECTION;
      index += 1
    ) {
      expect(
        sendIdempotencyStore.begin(
          connection(0),
          draft(index),
          fingerprint(index),
          expiry(),
        ).kind,
      ).toBe("owner");
    }

    expect(
      sendIdempotencyStore.begin(
        connection(0),
        draft(10_000),
        fingerprint(10_000),
        expiry(),
      ),
    ).toEqual({ kind: "capacity" });
    expect(
      sendIdempotencyStore.begin(
        connection(0),
        draft(0),
        fingerprint(0),
        expiry(),
      ).kind,
    ).toBe("pending");
    expect(
      sendIdempotencyStore.begin(
        connection(1),
        draft(10_000),
        fingerprint(10_000),
        expiry(),
      ).kind,
    ).toBe("owner");
  });

  it("fails closed at the completed-entry cap without evicting or cross-blocking", () => {
    for (
      let index = 0;
      index < MAX_SEND_IDEMPOTENCY_PER_CONNECTION;
      index += 1
    ) {
      complete(0, index);
    }

    expect(
      sendIdempotencyStore.begin(
        connection(0),
        draft(20_000),
        fingerprint(20_000),
        expiry(),
      ),
    ).toEqual({ kind: "capacity" });
    expect(
      sendIdempotencyStore.begin(
        connection(0),
        draft(0),
        fingerprint(0),
        expiry(),
      ).kind,
    ).toBe("replay");
    expect(
      sendIdempotencyStore.begin(
        connection(1),
        draft(20_000),
        fingerprint(20_000),
        expiry(),
      ).kind,
    ).toBe("owner");
  });

  it("enforces the total per-connection byte cap before the pending cap", () => {
    const large = {
      deliveryNoticeId: "22222222-2222-4222-8222-222222222222",
      deliveryStatus: "partial",
      id: id.message("界".repeat(2_048)),
      rejectedRecipients: Array.from(
        { length: 99 },
        (_, index) => `${index}-${"a".repeat(245)}@x.io`,
      ),
      submittedAt: "2026-07-30T12:00:00.000Z",
    } satisfies SendReceipt;
    const completedEntries = 320;
    for (let index = 0; index < completedEntries; index += 1) {
      complete(0, index, large);
    }
    const completedBytes = completedReceiptBytes(large) * completedEntries;
    const allowedPending = Math.floor(
      (MAX_SEND_IDEMPOTENCY_BYTES_PER_CONNECTION - completedBytes) /
        SEND_IDEMPOTENCY_PENDING_BYTES,
    );
    expect(allowedPending).toBeLessThan(
      MAX_SEND_IDEMPOTENCY_PENDING_PER_CONNECTION,
    );
    for (let index = 0; index < allowedPending; index += 1) {
      expect(
        sendIdempotencyStore.begin(
          connection(0),
          draft(30_000 + index),
          fingerprint(30_000 + index),
          expiry(),
        ).kind,
      ).toBe("owner");
    }

    expect(
      sendIdempotencyStore.begin(
        connection(0),
        draft(40_000),
        fingerprint(40_000),
        expiry(),
      ),
    ).toEqual({ kind: "capacity" });
    expect(
      sendIdempotencyStore.begin(
        connection(1),
        draft(40_000),
        fingerprint(40_000),
        expiry(),
      ).kind,
    ).toBe("owner");
  });

  it("uses actual completion bytes to free process reservation headroom", () => {
    const owners: { connectionIndex: number; entryIndex: number; token: string }[] =
      [];
    const reservations = MAX_SEND_IDEMPOTENCY_BYTES /
      SEND_IDEMPOTENCY_PENDING_BYTES;
    for (let index = 0; index < reservations; index += 1) {
      const connectionIndex = Math.floor(
        index / MAX_SEND_IDEMPOTENCY_PENDING_PER_CONNECTION,
      );
      owners.push({
        connectionIndex,
        entryIndex: index,
        token: ownerToken(
          sendIdempotencyStore.begin(
            connection(connectionIndex),
            draft(index),
            fingerprint(index),
            expiry(),
          ),
        ),
      });
    }
    expect(
      sendIdempotencyStore.begin(
        connection(owners.length),
        draft(50_000),
        fingerprint(50_000),
        expiry(),
      ),
    ).toEqual({ kind: "capacity" });

    for (const owner of owners.slice(0, 2)) {
      sendIdempotencyStore.complete(
        connection(owner.connectionIndex),
        draft(owner.entryIndex),
        owner.token,
        acceptedReceipt(owner.entryIndex),
      );
    }
    expect(
      sendIdempotencyStore.begin(
        connection(0),
        draft(50_000),
        fingerprint(50_000),
        expiry(),
      ).kind,
    ).toBe("owner");
  });
});
