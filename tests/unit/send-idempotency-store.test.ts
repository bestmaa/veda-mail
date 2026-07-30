import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SendReceipt } from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import {
  SEND_IDEMPOTENCY_TTL_MS,
  sendIdempotencyStore,
} from "@/server/mail/send-idempotency-store";

const connectionId = id.connection("send-idempotency-connection");
const draftId = id.draft("11111111-1111-4111-8111-111111111111");
const fingerprint = "a".repeat(64);
const connectionExpiry = (): number => Date.now() + 12 * 60 * 60 * 1_000;

const receipt = (
  deliveryStatus: "accepted" | "partial" | "uncertain" = "accepted",
): SendReceipt => ({
  ...(deliveryStatus === "accepted"
    ? {}
    : { deliveryNoticeId: "22222222-2222-4222-8222-222222222222" }),
  deliveryStatus,
  id: id.message("provider-message-id"),
  rejectedRecipients:
    deliveryStatus === "partial" ? ["Rejected@Example.com"] : [],
  submittedAt: "2026-07-30T12:00:00.000Z",
});

const ownerToken = (
  begin: ReturnType<typeof sendIdempotencyStore.begin>,
): string => {
  expect(begin.kind).toBe("owner");
  if (begin.kind !== "owner") throw new Error("Expected send ownership.");
  return begin.token;
};

beforeEach(() => {
  sendIdempotencyStore.clearAll();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("send idempotency store", () => {
  it("coalesces pending work and replays one defensively copied receipt", async () => {
    const token = ownerToken(
      sendIdempotencyStore.begin(
        connectionId,
        draftId,
        fingerprint,
        connectionExpiry(),
      ),
    );
    const coalesced = sendIdempotencyStore.begin(
      connectionId,
      draftId,
      fingerprint,
      connectionExpiry(),
    );
    expect(coalesced.kind).toBe("pending");
    if (coalesced.kind !== "pending") return;

    const terminal = receipt("partial");
    expect(
      sendIdempotencyStore.complete(
        connectionId,
        draftId,
        token,
        terminal,
      ),
    ).toEqual(terminal);
    await expect(coalesced.outcome).resolves.toEqual({
      kind: "completed",
      receipt: terminal,
    });

    const replay = sendIdempotencyStore.begin(
      connectionId,
      draftId,
      fingerprint,
      connectionExpiry(),
    );
    expect(replay).toEqual({ kind: "replay", receipt: terminal });
    if (replay.kind === "replay") {
      (replay.receipt.rejectedRecipients as string[]).push("mutation");
    }
    expect(
      sendIdempotencyStore.begin(
        connectionId,
        draftId,
        fingerprint,
        connectionExpiry(),
      ),
    ).toEqual({ kind: "replay", receipt: terminal });
    expect(
      sendIdempotencyStore.begin(
        connectionId,
        draftId,
        "b".repeat(64),
        connectionExpiry(),
      ),
    ).toEqual({ kind: "conflict" });
  });

  it("conflicts on changed intent and releases definitive failures", async () => {
    const token = ownerToken(
      sendIdempotencyStore.begin(
        connectionId,
        draftId,
        fingerprint,
        connectionExpiry(),
      ),
    );
    expect(
      sendIdempotencyStore.begin(
        connectionId,
        draftId,
        "b".repeat(64),
        connectionExpiry(),
      ),
    ).toEqual({ kind: "conflict" });
    const pending = sendIdempotencyStore.begin(
      connectionId,
      draftId,
      fingerprint,
      connectionExpiry(),
    );
    if (pending.kind !== "pending") throw new Error("Expected pending send.");
    const failure = new Error("definitive failure");

    expect(
      sendIdempotencyStore.fail(
        connectionId,
        draftId,
        token,
        failure,
      ),
    ).toBe(true);
    await expect(pending.outcome).resolves.toEqual({
      error: failure,
      kind: "failed",
    });
    expect(
      sendIdempotencyStore.begin(
        connectionId,
        draftId,
        fingerprint,
        connectionExpiry(),
      ).kind,
    ).toBe("owner");
  });

  it("starts terminal TTL at completion while pending work survives it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-30T00:00:00.000Z"));
    const expiry = connectionExpiry();
    const token = ownerToken(
      sendIdempotencyStore.begin(
        connectionId,
        draftId,
        fingerprint,
        expiry,
      ),
    );

    vi.advanceTimersByTime(SEND_IDEMPOTENCY_TTL_MS + 1);
    expect(
      sendIdempotencyStore.begin(
        connectionId,
        draftId,
        fingerprint,
        expiry,
      ).kind,
    ).toBe("pending");
    sendIdempotencyStore.complete(
      connectionId,
      draftId,
      token,
      receipt(),
    );

    vi.advanceTimersByTime(SEND_IDEMPOTENCY_TTL_MS - 1);
    expect(
      sendIdempotencyStore.begin(
        connectionId,
        draftId,
        fingerprint,
        expiry,
      ).kind,
    ).toBe("replay");
    vi.advanceTimersByTime(2);
    expect(
      sendIdempotencyStore.begin(
        connectionId,
        draftId,
        fingerprint,
        expiry,
      ).kind,
    ).toBe("owner");
  });

  it("orphans waiters and prevents a late completion from recreating state", async () => {
    const token = ownerToken(
      sendIdempotencyStore.begin(
        connectionId,
        draftId,
        fingerprint,
        connectionExpiry(),
      ),
    );
    const pending = sendIdempotencyStore.begin(
      connectionId,
      draftId,
      fingerprint,
      connectionExpiry(),
    );
    if (pending.kind !== "pending") throw new Error("Expected pending send.");

    sendIdempotencyStore.clear(connectionId);

    await expect(pending.outcome).resolves.toEqual({ kind: "orphaned" });
    expect(
      sendIdempotencyStore.complete(
        connectionId,
        draftId,
        token,
        receipt(),
      ),
    ).toBeNull();
    expect(
      sendIdempotencyStore.begin(
        connectionId,
        draftId,
        fingerprint,
        connectionExpiry(),
      ).kind,
    ).toBe("owner");
  });

});
