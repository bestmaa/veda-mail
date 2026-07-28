import { describe, expect, it } from "vitest";

import {
  safeMessageId,
  safeMessageIds,
  safeReplyReferences,
} from "@/infrastructure/providers/message-id";

describe("provider message identifier safety", () => {
  it("rejects values that are unsafe for outbound headers", () => {
    expect(safeMessageId(" source@example.com ")).toBe(
      "source@example.com",
    );
    expect(safeMessageId("source@example.com\r\nBcc: victim@example.com"))
      .toBeNull();
    expect(safeMessageId(`source\u0000@example.com`)).toBeNull();
    expect(safeMessageId("a".repeat(999))).toBeNull();
  });

  it("deduplicates and bounds reference chains", () => {
    const references = safeMessageIds([
      "first@example.com",
      "FIRST@example.com",
      ...Array.from(
        { length: 60 },
        (_, index) => `${index}-${"a".repeat(880)}@example.com`,
      ),
    ]);

    expect(references[0]).toBe("first@example.com");
    expect(references.length).toBeLessThanOrEqual(50);
    expect(
      references.reduce(
        (total, value) => total + Buffer.byteLength(value, "utf8"),
        0,
      ),
    ).toBeLessThanOrEqual(8_192);
  });

  it("always keeps the direct parent as the final bounded reference", () => {
    const parent = "direct-parent@example.com";
    const references = safeReplyReferences(
      Array.from(
        { length: 60 },
        (_, index) => `${index}-${"a".repeat(880)}@example.com`,
      ),
      parent,
    );

    expect(references.at(-1)).toBe(parent);
    expect(references.length).toBeLessThanOrEqual(50);
    expect(
      references.reduce(
        (total, value) => total + Buffer.byteLength(value, "utf8"),
        0,
      ),
    ).toBeLessThanOrEqual(8_192);
  });

  it("deduplicates the direct parent from older references", () => {
    expect(
      safeReplyReferences(
        ["older@example.com", "DIRECT@example.com"],
        "direct@example.com",
      ),
    ).toEqual(["older@example.com", "direct@example.com"]);
  });
});
