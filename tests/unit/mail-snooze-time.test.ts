import { afterEach, describe, expect, it } from "vitest";

import {
  snoozeLocalDateTimeValue,
  snoozeLocalTimeToIso,
  snoozePresets,
  snoozeTimeLimits,
} from "@/presentation/features/mail-workspace/mail-snooze-time";

const originalTimeZone = process.env["TZ"];
afterEach(() => { process.env["TZ"] = originalTimeZone; });

describe("mail snooze local time", () => {
  it("builds stable presets and rolls next Monday forward", () => {
    process.env["TZ"] = "Asia/Kolkata";
    const now = new Date(2026, 7, 3, 10, 2);
    const presets = snoozePresets(now);
    expect(presets.map(({ value }) => value)).toEqual([
      "2026-08-03T18:00", "2026-08-04T08:00", "2026-08-10T08:00",
    ]);
  });

  it("rejects malformed, past, impossible, and over-limit values", () => {
    const now = new Date(2026, 7, 4, 10, 0);
    expect(snoozeLocalTimeToIso("2026-02-30T10:00", now)).toBeNull();
    expect(snoozeLocalTimeToIso("2026-08-04T10:00", now)).toBeNull();
    expect(snoozeLocalTimeToIso("2028-08-04T10:00", now)).toBeNull();
    expect(snoozeTimeLimits(now)).toEqual({ maximum: "2027-08-05T10:00", minimum: "2026-08-04T10:01" });
  });

  it("rejects a daylight-saving gap and resolves a valid local instant", () => {
    process.env["TZ"] = "America/New_York";
    const now = new Date(2026, 2, 8, 0, 0);
    expect(snoozeLocalTimeToIso("2026-03-08T02:30", now)).toBeNull();
    const value = "2026-03-08T03:30";
    expect(snoozeLocalTimeToIso(value, now)).toBe(new Date(value).toISOString());
    expect(snoozeLocalDateTimeValue(new Date(value))).toBe(value);
  });
});
