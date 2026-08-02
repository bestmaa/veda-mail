import { describe, expect, it } from "vitest";

import { MailSearchSyntaxError } from "@/domain/mail/mail-search";
import {
  parseMailSearch,
  serializeMailSearch,
} from "@/domain/mail/mail-search-parser";

describe("mail search parser", () => {
  it("parses the portable grammar and creates one canonical form", () => {
    expect(parseMailSearch(
      'from:"Ada Lovelace" to:team@example.com cc:lead@example.com ' +
      'subject:"release plan" body:rollback "exact phrase" ' +
      "after:2026-07-01 before:2026-08-01 larger:10K smaller:2M " +
      'has:attachment in:"Project Alpha" is:unread is:starred',
    )).toEqual({
      canonical:
        'from:"Ada Lovelace" to:team@example.com cc:lead@example.com ' +
        'subject:"release plan" body:rollback "exact phrase" ' +
        "after:2026-07-01 before:2026-08-01 larger:10240 smaller:2097152 " +
        'has:attachment in:"Project Alpha" is:unread is:starred',
      criteria: [
        { field: "from", phrase: true, type: "text", value: "Ada Lovelace" },
        { field: "to", type: "text", value: "team@example.com" },
        { field: "cc", type: "text", value: "lead@example.com" },
        { field: "subject", phrase: true, type: "text", value: "release plan" },
        { field: "body", type: "text", value: "rollback" },
        { field: "text", phrase: true, type: "text", value: "exact phrase" },
        { boundary: "after", date: "2026-07-01", type: "date" },
        { boundary: "before", date: "2026-08-01", type: "date" },
        { boundary: "larger", bytes: 10_240, type: "size" },
        { boundary: "smaller", bytes: 2_097_152, type: "size" },
        { type: "has-attachment" },
        { type: "mailbox", value: "Project Alpha" },
        { state: "unread", type: "state" },
        { state: "starred", type: "state" },
      ],
    });
  });

  it("preserves escaped quotes and backslashes in bounded phrases", () => {
    const parsed = parseMailSearch('subject:"say \\"hello\\"" body:"C:\\\\mail"');

    expect(parsed.criteria).toEqual([
      { field: "subject", phrase: true, type: "text", value: 'say "hello"' },
      { field: "body", phrase: true, type: "text", value: "C:\\mail" },
    ]);
    expect(parseMailSearch(parsed.canonical)).toEqual(parsed);
    expect(serializeMailSearch(parsed.criteria)).toBe(parsed.canonical);
  });

  it("preserves exact intent for a quoted single-word phrase", () => {
    expect(parseMailSearch('subject:"Release"')).toEqual({
      canonical: 'subject:"Release"',
      criteria: [{ field: "subject", phrase: true, type: "text", value: "Release" }],
    });
  });

  it.each([
    ["after:2026-01-01 after:2026-09-01 before:2026-08-01", "date range"],
    ["larger:1K larger:20K smaller:10K", "size range"],
  ])("validates every repeated boundary in %s", (input, message) => {
    expect(() => parseMailSearch(input)).toThrow(message);
  });

  it.each([
    ["from:", "missing its value"],
    ['subject:"unfinished', "unfinished quote"],
    ["after:2026-02-30", "invalid date"],
    ["after:0000-01-01", "YYYY-MM-DD"],
    ["after:07/01/2026", "YYYY-MM-DD"],
    ["larger:0", "outside the supported range"],
    ["larger:2T", "use K, M, or G"],
    ["has:inline", "Only has:attachment"],
    ["is:draft", "supports read"],
    ["label:finance", "label: search operator is not supported"],
    ["is:read is:unread", "conflicting states"],
    ["is:starred is:unstarred", "conflicting states"],
    ["in:inbox in:sent", "Only one in: mailbox"],
    ["after:2026-08-01 before:2026-08-01", "date range is empty"],
    ["larger:10K smaller:10K", "size range is empty"],
  ])("rejects invalid search %s", (input, message) => {
    try {
      parseMailSearch(input);
      throw new Error("Expected the mail search to be rejected.");
    } catch (error) {
      expect(error).toBeInstanceOf(MailSearchSyntaxError);
      expect((error as Error).message).toContain(message);
    }
  });

  it("bounds term count, individual values, and control characters", () => {
    expect(() => parseMailSearch(Array.from({ length: 21 }, () => "term").join(" ")))
      .toThrow("too many terms");
    expect(() => parseMailSearch(`subject:${"x".repeat(201)}`))
      .toThrow("invalid or too long");
    expect(() => parseMailSearch("x".repeat(1_001))).toThrow("too long");
    expect(() => parseMailSearch("subject:hello\u0000world"))
      .toThrow("invalid or too long");
  });
});
