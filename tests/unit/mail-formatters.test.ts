import { describe, expect, it } from "vitest";

import {
  formatFileSize,
  formatFullDate,
  formatMailNumber,
  formatMessageDate,
  formatSender,
  initials,
} from "@/presentation/shared/formatters/mail-formatters";

describe("mail formatters", () => {
  it("uses a sender name before its address", () => {
    expect(
      formatSender([{ email: "hello@example.com", name: "Hello Team" }]),
    ).toBe("Hello Team");
  });

  it("formats sizes and initials consistently", () => {
    expect(formatFileSize(2_430_000)).toBe("2.3 MB");
    expect(initials("Tech Consultancy")).toBe("TC");
    expect(initials("Aditya")).toBe("A");
  });

  it("formats dates, numbers, and sizes for the selected locale and zone", () => {
    const value = "2026-08-05T20:30:00.000Z";
    expect(formatFullDate(value, "hi-IN", "Asia/Kolkata"))
      .toContain("6 अगस्त 2026");
    expect(formatMessageDate(value, "en-IN", "America/New_York"))
      .not.toBe(formatMessageDate(value, "en-IN", "Asia/Kolkata"));
    expect(formatMailNumber(123_456, "ar")).toMatch(/[٠-٩]/u);
    expect(formatFileSize(2_430_000, "ar")).toMatch(/[٠-٩]/u);
  });
});
