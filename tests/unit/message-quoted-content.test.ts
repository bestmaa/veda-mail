import { describe, expect, it } from "vitest";

import {
  hasSanitizedHtmlQuote,
  splitPlainMessageContent,
} from "@/presentation/features/mail-workspace/message-quoted-content";

describe("quoted message content", () => {
  it("separates an ordinary reply quote without removing the visible response", () => {
    expect(splitPlainMessageContent(
      "Thanks, this works.\n\nOn 3 Aug 2026, Ada wrote:\n> Earlier text",
    )).toEqual({
      quoted: "On 3 Aug 2026, Ada wrote:\n> Earlier text",
      visible: "Thanks, this works.",
    });
  });

  it("recognizes forwarded blocks and quote-only messages", () => {
    expect(splitPlainMessageContent(
      "FYI\n\n---------- Forwarded message ----------\nFrom: Ada",
    ).quoted).toContain("Forwarded message");
    expect(splitPlainMessageContent("> Quote only")).toEqual({
      quoted: "> Quote only",
      visible: "",
    });
  });

  it("does not collapse ordinary text that happens to end with wrote", () => {
    const value = "On the report Ada wrote:\nThis is still the new message.";
    expect(splitPlainMessageContent(value)).toEqual({ quoted: "", visible: value });
  });

  it("detects only sanitized HTML blockquotes", () => {
    expect(hasSanitizedHtmlQuote("<blockquote>Earlier</blockquote>")).toBe(true);
    expect(hasSanitizedHtmlQuote("<p>blockquote is a word</p>")).toBe(false);
  });

  it("normalizes a missing plain body for HTML-only provider messages", () => {
    expect(splitPlainMessageContent(null)).toEqual({ quoted: "", visible: "" });
    expect(splitPlainMessageContent(undefined)).toEqual({ quoted: "", visible: "" });
  });
});
