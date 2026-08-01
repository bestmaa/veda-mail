import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ComposerAutosaveCoordinator } from "@/presentation/features/mail-workspace/composer-autosave-coordinator";
import {
  COMPOSER_AUTOSAVE_IDLE_MS,
  type ComposerAutosaveInput,
  type ComposerAutosaveStatus,
} from "@/presentation/features/mail-workspace/composer-autosave.types";

const setup = (overrides: Partial<ComposerAutosaveInput> = {}) => {
  const statuses: ComposerAutosaveStatus[] = [];
  let input: ComposerAutosaveInput = {
    autosave: vi.fn().mockResolvedValue(true),
    contentGeneration: 1,
    enabled: true,
    hasLocalAttachments: false,
    hasUserEdits: true,
    paused: false,
    reconcile: vi.fn().mockResolvedValue(true),
    retryKind: "none",
    ...overrides,
  };
  const coordinator = new ComposerAutosaveCoordinator((status) => {
    statuses.push(status);
  });
  const update = (next: Partial<ComposerAutosaveInput> = {}) => {
    input = { ...input, ...next };
    coordinator.update(input);
  };
  return { coordinator, statuses, update };
};

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-01T00:00:00.000Z"));
});

afterEach(() => vi.useRealTimers());

describe("composer autosave race barriers", () => {
  it("continues exact reconciliation without requiring a render per failure", async () => {
    const reconcile = vi.fn().mockResolvedValue(false);
    const harness = setup({ reconcile, retryKind: "reconcile" });
    harness.update();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(reconcile).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(3_999);
    expect(reconcile).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);

    expect(reconcile).toHaveBeenCalledTimes(2);
  });

  it("provisionally blocks an unclassified failure instead of looping", async () => {
    const autosave = vi.fn().mockResolvedValue(false);
    const harness = setup({ autosave });
    harness.update();
    await vi.advanceTimersByTimeAsync(COMPOSER_AUTOSAVE_IDLE_MS);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(autosave).toHaveBeenCalledOnce();
    expect(harness.statuses.at(-1)?.phase).toBe("blocked");
  });

  it("honors a definitive block reported before reconciliation settles", async () => {
    const pending = Promise.withResolvers<boolean>();
    const reconcile = vi.fn(() => pending.promise);
    const harness = setup({ reconcile, retryKind: "reconcile" });
    harness.update();
    await vi.advanceTimersByTimeAsync(2_000);
    harness.update({ retryKind: "blocked" });
    pending.resolve(false);
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(reconcile).toHaveBeenCalledOnce();
    expect(harness.statuses.at(-1)?.phase).toBe("blocked");
  });

  it("ignores a late settlement after the scheduler is disabled", async () => {
    const pending = Promise.withResolvers<boolean>();
    const first = vi.fn(() => pending.promise);
    const latest = vi.fn().mockResolvedValue(true);
    const harness = setup({ autosave: first });
    harness.update();
    await vi.advanceTimersByTimeAsync(COMPOSER_AUTOSAVE_IDLE_MS);
    harness.update({ enabled: false });
    pending.resolve(true);
    await flush();
    harness.update({
      autosave: latest, contentGeneration: 2, enabled: true,
    });
    await vi.advanceTimersByTimeAsync(COMPOSER_AUTOSAVE_IDLE_MS);

    expect(first).toHaveBeenCalledOnce();
    expect(latest).toHaveBeenCalledOnce();
  });
});
