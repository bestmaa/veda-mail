import { describe, expect, it } from "vitest";

import { accessibleForeground } from "@/domain/shared/color-contrast";

const luminance = (color: string): number => {
  const channels = color.slice(1).match(/.{2}/g)?.map((channel) => {
    const value = Number.parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) ?? [0, 0, 0];
  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) +
    0.0722 * (channels[2] ?? 0);
};

const contrast = (left: string, right: string): number => {
  const [lighter, darker] = [luminance(left), luminance(right)]
    .sort((a, b) => b - a);
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
};

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

  it("meets 4.5:1 across the web-safe branding color cube", () => {
    const channels = [0x00, 0x33, 0x66, 0x99, 0xcc, 0xff];
    for (const red of channels) for (const green of channels) {
      for (const blue of channels) {
        const background = `#${[red, green, blue]
          .map((value) => value.toString(16).padStart(2, "0")).join("")}`;
        expect(contrast(accessibleForeground(background), background))
          .toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
