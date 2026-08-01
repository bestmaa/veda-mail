import { describe, expect, it } from "vitest";

import {
  createLabelId,
  labelIdFromKeyword,
} from "@/domain/mail/label";
import {
  assertLabelCapacity,
  assertUniqueLabelName,
  normalizeLabelName,
} from "@/domain/mail/label-policy";

describe("portable label policy", () => {
  it("creates an opaque lowercase keyword from exactly 128 bits", () => {
    const labelId = createLabelId("000102030405060708090a0b0c0d0e0f");

    expect(labelId).toBe("veda-label-aaaqeayeaudaocajbifqydiob4");
    expect(labelIdFromKeyword(labelId.toUpperCase())).toBe(labelId);
    expect(labelIdFromKeyword("$important")).toBeNull();
  });

  it("normalizes safe names and rejects hostile text", () => {
    expect(normalizeLabelName("  Customers  ")).toBe("Customers");
    expect(normalizeLabelName("Ｃustomers")).toBe("Customers");
    expect(() => normalizeLabelName("bad\nname")).toThrow(/single-line/u);
    expect(() => normalizeLabelName("bad\ud800name")).toThrow(/single-line/u);
    expect(() => normalizeLabelName("x".repeat(101))).toThrow(/100/u);
  });

  it("rejects NFKC and case-insensitive duplicates", () => {
    const existing = [{
      color: "#64748b" as const,
      id: createLabelId("000102030405060708090a0b0c0d0e0f"),
      name: "Ｃustomers",
    }];
    expect(() => assertUniqueLabelName(existing, "customers")).toThrow(
      /already exists/u,
    );
  });

  it("caps each account at 256 labels", () => {
    const labels = Array.from({ length: 256 }, (_, index) => ({
      color: "#64748b" as const,
      id: createLabelId(index.toString(16).padStart(32, "0")),
      name: `Label ${index}`,
    }));
    expect(() => assertLabelCapacity(labels)).toThrow(/256/u);
  });
});
