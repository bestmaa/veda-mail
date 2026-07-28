import { describe, expect, it } from "vitest";

import { accessibleForeground } from "@/domain/shared/color-contrast";

describe("accessible brand foreground", () => {
  it("uses black on a light accent", () => {
    expect(accessibleForeground("#ff785a")).toBe("#000000");
  });

  it("uses white on a dark accent", () => {
    expect(accessibleForeground("#292c68")).toBe("#ffffff");
  });

  it("fails closed to black for an unexpected color", () => {
    expect(accessibleForeground("not-a-color")).toBe("#000000");
  });
});
