import { describe, expect, it } from "vitest";

import {
  MAX_MESSAGE_LIST_PREVIEW_CHARACTERS,
  MAX_MESSAGE_LIST_PREVIEW_UTF8_BYTES,
  normalizeMessageListPreview,
} from "@/domain/mail/message-list-preview";

describe("message list preview normalization", () => {
  it("collapses whitespace and removes control and bidi override characters", () => {
    expect(normalizeMessageListPreview(
      "  Hello\n\u0000  safe\u202e text\u2066  ",
    )).toBe("Hello safe text");
  });

  it("bounds both Unicode characters and UTF-8 bytes", () => {
    const ascii = normalizeMessageListPreview("a".repeat(2_000));
    const unicode = normalizeMessageListPreview("😀".repeat(2_000));
    expect([...ascii]).toHaveLength(MAX_MESSAGE_LIST_PREVIEW_CHARACTERS);
    expect([...unicode].length).toBeLessThanOrEqual(
      MAX_MESSAGE_LIST_PREVIEW_CHARACTERS,
    );
    expect(new TextEncoder().encode(unicode).byteLength).toBeLessThanOrEqual(
      MAX_MESSAGE_LIST_PREVIEW_UTF8_BYTES,
    );
  });
});
