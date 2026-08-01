import { describe, expect, it, vi } from "vitest";

import { runMailboxEmptyBatches } from "@/presentation/features/mail-workspace/mailbox-empty-runner";

describe("mailbox empty batch runner", () => {
  it("allows one prepare-only batch before deleting the confirmed snapshot", async () => {
    const emptyNextBatch = vi.fn()
      .mockResolvedValueOnce({ complete: false, processed: 0, removed: 0 })
      .mockResolvedValueOnce({ complete: true, processed: 2, removed: 2 });

    await expect(runMailboxEmptyBatches({
      emptyNextBatch,
      initial: { processed: 0, removed: 0 },
      isCurrent: () => true,
      onProgress: vi.fn(),
    })).resolves.toEqual({ complete: true, processed: 2, removed: 2 });
    expect(emptyNextBatch).toHaveBeenCalledTimes(2);
  });

  it("automatically resumes bounded batches until completion", async () => {
    const emptyNextBatch = vi.fn()
      .mockResolvedValueOnce({ complete: false, processed: 100, removed: 98 })
      .mockResolvedValueOnce({ complete: false, processed: 200, removed: 197 })
      .mockResolvedValueOnce({ complete: true, processed: 203, removed: 200 });
    const onProgress = vi.fn();

    await expect(runMailboxEmptyBatches({
      emptyNextBatch,
      initial: { processed: 0, removed: 0 },
      isCurrent: () => true,
      onProgress,
    })).resolves.toEqual({ complete: true, processed: 203, removed: 200 });
    expect(emptyNextBatch).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenCalledTimes(3);
  });

  it("stops a stalled incomplete cleanup instead of spinning forever", async () => {
    await expect(runMailboxEmptyBatches({
      emptyNextBatch: async () => ({
        complete: false,
        processed: 10,
        removed: 10,
      }),
      initial: { processed: 10, removed: 10 },
      isCurrent: () => true,
      onProgress: vi.fn(),
    })).rejects.toThrow("without making progress");
  });

  it("stops when the prepare-only batch is followed by another stalled batch", async () => {
    const emptyNextBatch = vi.fn().mockResolvedValue({
      complete: false,
      processed: 0,
      removed: 0,
    });

    await expect(runMailboxEmptyBatches({
      emptyNextBatch,
      initial: { processed: 0, removed: 0 },
      isCurrent: () => true,
      onProgress: vi.fn(),
    })).rejects.toThrow("without making progress");
    expect(emptyNextBatch).toHaveBeenCalledTimes(2);
  });

  it("drops stale progress after the mailbox session changes", async () => {
    let current = true;
    const onProgress = vi.fn();

    const result = await runMailboxEmptyBatches({
      emptyNextBatch: async () => {
        current = false;
        return { complete: false, processed: 100, removed: 100 };
      },
      initial: { processed: 0, removed: 0 },
      isCurrent: () => current,
      onProgress,
    });

    expect(result).toBeNull();
    expect(onProgress).not.toHaveBeenCalled();
  });
});
