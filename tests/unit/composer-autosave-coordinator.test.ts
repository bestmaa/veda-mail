import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ComposerAutosaveCoordinator } from "@/presentation/features/mail-workspace/composer-autosave-coordinator";
import {
  COMPOSER_AUTOSAVE_IDLE_MS,
  COMPOSER_AUTOSAVE_MAX_WAIT_MS,
  COMPOSER_AUTOSAVE_RETRY_MAX_MS,
  composerAutosaveRetryDelay,
  type ComposerAutosaveInput,
  type ComposerAutosaveStatus,
} from "@/presentation/features/mail-workspace/composer-autosave.types";

const makeHarness = (overrides: Partial<ComposerAutosaveInput> = {}) => {
  const autosave = vi.fn().mockResolvedValue(true);
  const reconcile = vi.fn().mockResolvedValue(true);
  const statuses: ComposerAutosaveStatus[] = [];
  const coordinator = new ComposerAutosaveCoordinator((status) => {
    statuses.push(status);
  });
  let input: ComposerAutosaveInput = {
    autosave,
    contentGeneration: 1,
    enabled: true,
    hasLocalAttachments: false,
    hasUserEdits: true,
    paused: false,
    reconcile,
    retryKind: "none",
    ...overrides,
  };
  const update = (next: Partial<ComposerAutosaveInput> = {}) => {
    input = { ...input, ...next };
    coordinator.update(input);
  };
  return { autosave, coordinator, input: () => input, reconcile, statuses, update };
};

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-01T00:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("composer autosave timing", () => {
  it("saves only after two idle seconds", async () => {
    const harness = makeHarness();
    harness.update();

    await vi.advanceTimersByTimeAsync(COMPOSER_AUTOSAVE_IDLE_MS - 1);
    expect(harness.autosave).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(harness.autosave).toHaveBeenCalledOnce();
  });

  it("caps a continuous edit burst at fifteen seconds", async () => {
    const harness = makeHarness();
    harness.update();
    for (let generation = 2; generation <= 9; generation += 1) {
      await vi.advanceTimersByTimeAsync(1_800);
      harness.update({ contentGeneration: generation });
    }

    await vi.advanceTimersByTimeAsync(
      COMPOSER_AUTOSAVE_MAX_WAIT_MS - 8 * 1_800 - 1,
    );
    expect(harness.autosave).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(harness.autosave).toHaveBeenCalledOnce();
  });

  it("pauses offline and resumes an elapsed dirty deadline immediately", async () => {
    const harness = makeHarness();
    harness.coordinator.setOnline(false);
    harness.update();
    await vi.advanceTimersByTimeAsync(COMPOSER_AUTOSAVE_MAX_WAIT_MS + 5_000);
    expect(harness.autosave).not.toHaveBeenCalled();

    harness.coordinator.setOnline(true);
    await vi.advanceTimersByTimeAsync(0);

    expect(harness.autosave).toHaveBeenCalledOnce();
    expect(harness.statuses).toContainEqual(expect.objectContaining({
      phase: "offline",
    }));
  });

  it("never autosaves absent user intent, with attachments, or while paused", async () => {
    const harness = makeHarness({ hasUserEdits: false });
    harness.update();
    await vi.advanceTimersByTimeAsync(30_000);
    harness.update({ hasLocalAttachments: true, hasUserEdits: true });
    await vi.advanceTimersByTimeAsync(30_000);
    harness.update({ hasLocalAttachments: false, paused: true });
    await vi.advanceTimersByTimeAsync(30_000);

    expect(harness.autosave).not.toHaveBeenCalled();
    expect(harness.statuses.at(-1)?.phase).toBe("paused");
  });
});

describe("composer autosave serialization", () => {
  it("coalesces edits during a save into one trailing latest mutation", async () => {
    const pending = Promise.withResolvers<boolean>();
    const first = vi.fn(() => pending.promise);
    const latest = vi.fn().mockResolvedValue(true);
    const harness = makeHarness({ autosave: first });
    harness.update();
    await vi.advanceTimersByTimeAsync(COMPOSER_AUTOSAVE_IDLE_MS);
    expect(first).toHaveBeenCalledOnce();

    harness.update({ contentGeneration: 2 });
    harness.update({ autosave: latest, contentGeneration: 3 });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(latest).not.toHaveBeenCalled();

    pending.resolve(true);
    await flushPromises();
    expect(latest).not.toHaveBeenCalled();
    harness.update();
    await flushPromises();

    expect(first).toHaveBeenCalledOnce();
    expect(latest).toHaveBeenCalledOnce();
  });

  it("keeps a trailing save paused until the composer is safe to persist", async () => {
    const pending = Promise.withResolvers<boolean>();
    const first = vi.fn(() => pending.promise);
    const latest = vi.fn().mockResolvedValue(true);
    const harness = makeHarness({ autosave: first });
    harness.update();
    await vi.advanceTimersByTimeAsync(COMPOSER_AUTOSAVE_IDLE_MS);
    harness.update({ autosave: latest, contentGeneration: 2, paused: true });
    pending.resolve(true);
    await flushPromises();
    harness.update();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(latest).not.toHaveBeenCalled();

    harness.update({ paused: false });
    await flushPromises();

    expect(latest).toHaveBeenCalledOnce();
  });

  it("stops a blocked failure until a new edit explicitly clears it", async () => {
    const harness = makeHarness({ retryKind: "blocked" });
    harness.update();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(harness.autosave).not.toHaveBeenCalled();

    harness.update({ contentGeneration: 2, retryKind: "none" });
    await vi.advanceTimersByTimeAsync(COMPOSER_AUTOSAVE_IDLE_MS);

    expect(harness.autosave).toHaveBeenCalledOnce();
  });
});

describe("composer autosave retry policy", () => {
  it("uses exact reconciliation with bounded exponential backoff", async () => {
    const autosave = vi.fn().mockResolvedValue(false);
    const reconcile = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const harness = makeHarness({ autosave, reconcile });
    harness.update();
    await vi.advanceTimersByTimeAsync(COMPOSER_AUTOSAVE_IDLE_MS);
    harness.update({ retryKind: "reconcile" });
    harness.update({ contentGeneration: 2, retryKind: "none" });

    await vi.advanceTimersByTimeAsync(1_999);
    expect(reconcile).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(reconcile).toHaveBeenCalledOnce();
    harness.update({ retryKind: "reconcile" });
    await vi.advanceTimersByTimeAsync(3_999);
    expect(reconcile).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);

    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(autosave).toHaveBeenCalledOnce();
    expect(composerAutosaveRetryDelay(99)).toBe(COMPOSER_AUTOSAVE_RETRY_MAX_MS);
  });

  it("retries a definitive throttle as a fresh latest autosave", async () => {
    const first = vi.fn().mockResolvedValue(false);
    const latest = vi.fn().mockResolvedValue(true);
    const reconcile = vi.fn().mockResolvedValue(true);
    const harness = makeHarness({ autosave: first, reconcile });
    harness.update();
    await vi.advanceTimersByTimeAsync(COMPOSER_AUTOSAVE_IDLE_MS);
    harness.update({ autosave: latest, retryKind: "backoff" });
    harness.update({ contentGeneration: 2, retryKind: "none" });
    await vi.advanceTimersByTimeAsync(COMPOSER_AUTOSAVE_IDLE_MS);

    expect(first).toHaveBeenCalledOnce();
    expect(latest).toHaveBeenCalledOnce();
    expect(reconcile).not.toHaveBeenCalled();
  });
});
