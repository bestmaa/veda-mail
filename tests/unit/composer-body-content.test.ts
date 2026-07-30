import { describe, expect, it } from "vitest";

import {
  COMPOSER_RICH_TRANSFER_LINE_LIMIT_MESSAGE,
  composerHtmlHasFormatting,
  composerTransferExceedsRichLineLimit,
  normalizeComposerLink,
  normalizeComposerTransferText,
  plainTextToComposerHtml,
} from "@/presentation/features/mail-workspace/composer-body-content";

describe("composer body content", () => {
  it("escapes plain drafts before loading the rich editor", () => {
    expect(
      plainTextToComposerHtml("Hello <script>\n\n& goodbye"),
    ).toBe(
      "<p>Hello &lt;script&gt;<br><br>&amp; goodbye</p>",
    );
  });

  it("detects formatting that would be removed in plain-text mode", () => {
    expect(composerHtmlHasFormatting("<p>Plain<br>line</p>")).toBe(false);
    expect(composerHtmlHasFormatting("<p><strong>Bold</strong></p>")).toBe(
      true,
    );
    expect(composerHtmlHasFormatting('<p><a href="https://example.com">x</a></p>')).toBe(
      true,
    );
  });

  it("normalizes transfer line endings and caps rich node expansion", () => {
    expect(normalizeComposerTransferText("one\r\ntwo\rthree")).toBe(
      "one\ntwo\nthree",
    );
    expect(composerTransferExceedsRichLineLimit("\n".repeat(999))).toBe(false);
    expect(composerTransferExceedsRichLineLimit("\n".repeat(1_000))).toBe(true);
    expect(COMPOSER_RICH_TRANSFER_LINE_LIMIT_MESSAGE).toContain(
      "plain text mode",
    );
  });

  it.each([
    ["https://Example.com/path?q=1", "https://example.com/path?q=1"],
    ["http://example.com", "http://example.com/"],
    ["mailto:person@example.com", "mailto:person@example.com"],
  ])("accepts and normalizes safe absolute links", (input, output) => {
    expect(normalizeComposerLink(input)).toBe(output);
  });

  it.each([
    "",
    "/relative",
    "//example.com/path",
    "javascript:alert(1)",
    "data:text/html,hello",
    "https://user:secret@example.com",
    "mailto:",
    "mailto:person@example.com#fragment",
    "mailto:person@example.com?subject=Injected",
    "mailto:first@example.com,second@example.com",
    "mailto:not-an-address",
    "mailto:te%E2%80%AEam@example.com",
    `https://example.com/${"a".repeat(2_048)}`,
    `https://example.com/${"é".repeat(1_020)}`,
    "https://example.com/\u0000",
    "https://example.com/\ud800",
  ])("rejects unsafe composer link %s", (input) => {
    expect(normalizeComposerLink(input)).toBeNull();
  });
});
