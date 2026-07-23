import { describe, expect, it } from "vitest";

import {
  formatFileSize,
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
});
