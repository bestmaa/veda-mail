import { describe, expect, it } from "vitest";

import {
  defaultScheduledLocalTime,
  localDateTimeValue,
  scheduledLocalTimeToIso,
} from "@/presentation/features/mail-workspace/composer-schedule-time";

describe("composer schedule time", () => {
  it("round-trips an explicit local wall-clock time to one UTC instant", () => {
    const now = new Date("2026-08-02T08:00:00.000Z");
    const future = new Date(now.getTime() + 2 * 60 * 60 * 1_000);
    const local = localDateTimeValue(future);
    expect(scheduledLocalTimeToIso(local, now)).toBe(future.toISOString());
  });

  it("rejects malformed, past, normalized, and over-horizon values", () => {
    const now = new Date("2026-08-02T08:00:00.000Z");
    expect(scheduledLocalTimeToIso("not-a-date", now)).toBeNull();
    expect(scheduledLocalTimeToIso(localDateTimeValue(now), now)).toBeNull();
    const tooLate = new Date(now.getTime() + 367 * 24 * 60 * 60 * 1_000);
    expect(scheduledLocalTimeToIso(localDateTimeValue(tooLate), now)).toBeNull();
  });

  it("defaults to a five-minute-aligned time about one hour ahead", () => {
    const now = new Date(2026, 7, 2, 9, 2, 31);
    const value = defaultScheduledLocalTime(now);
    const resolved = new Date(value);
    expect(resolved.getTime()).toBeGreaterThanOrEqual(now.getTime() + 60 * 60 * 1_000);
    expect(resolved.getMinutes() % 5).toBe(0);
    expect(resolved.getSeconds()).toBe(0);
  });
});
