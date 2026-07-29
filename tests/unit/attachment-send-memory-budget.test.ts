import { afterEach, describe, expect, it, vi } from "vitest";

import { AttachmentSendMemoryBudget } from "@/server/mail/attachment-send-memory-budget";

afterEach(() => {
  vi.useRealTimers();
});

describe("attachment send plaintext memory budget", () => {
  it("serves bounded concurrent waiters in FIFO order", async () => {
    const budget = new AttachmentSendMemoryBudget({
      capacityBytes: 10,
      maxWaiters: 2,
      waitTimeoutMs: 1_000,
    });
    const active = await budget.acquire(8);
    const order: string[] = [];
    const large = budget.acquire(5).then((lease) => {
      order.push("large");
      return lease;
    });
    const small = budget.acquire(2).then((lease) => {
      order.push("small");
      return lease;
    });

    await Promise.resolve();
    expect(order).toEqual([]);
    active.release();
    const [largeLease, smallLease] = await Promise.all([large, small]);
    expect(order).toEqual(["large", "small"]);

    largeLease.release();
    smallLease.release();
  });

  it("rejects excess waiters without growing the queue", async () => {
    const budget = new AttachmentSendMemoryBudget({
      capacityBytes: 1,
      maxWaiters: 1,
      waitTimeoutMs: 1_000,
    });
    const active = await budget.acquire(1);
    const waiting = budget.acquire(1);

    await expect(budget.acquire(1)).rejects.toMatchObject({
      code: "ATTACHMENT_SEND_BUSY",
      status: 503,
    });
    active.release();
    (await waiting).release();
  });

  it("times out with a structured 503 and admits later work", async () => {
    vi.useFakeTimers();
    const budget = new AttachmentSendMemoryBudget({
      capacityBytes: 1,
      maxWaiters: 1,
      waitTimeoutMs: 50,
    });
    const active = await budget.acquire(1);
    const waiting = budget.acquire(1);
    const rejection = expect(waiting).rejects.toMatchObject({
      code: "ATTACHMENT_SEND_BUSY",
      status: 503,
    });

    await vi.advanceTimersByTimeAsync(50);
    await rejection;
    active.release();
    const later = await budget.acquire(1);
    later.release();
  });

  it("releases capacity exactly once after a failed operation", async () => {
    const budget = new AttachmentSendMemoryBudget({
      capacityBytes: 4,
      waitTimeoutMs: 1_000,
    });
    const lease = await budget.acquire(4);

    try {
      throw new Error("provider failed");
    } catch {
      lease.release();
      lease.release();
    }

    const retry = await budget.acquire(4);
    retry.release();
  });
});
