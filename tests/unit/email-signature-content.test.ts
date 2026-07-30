import { describe, expect, it } from "vitest";

import {
  MAX_EMAIL_SIGNATURE_CONTENT_CHARACTERS,
  MAX_EMAIL_SIGNATURE_HTML_DEPTH,
  MAX_EMAIL_SIGNATURE_HTML_NODES,
} from "@/domain/member/email-signature";
import { canonicalizeEmailSignatureContent } from "@/server/signatures/email-signature-content";
import { parseEmailSignaturePutOperation } from "@/server/signatures/email-signature.schema";

describe("email signature wire schema", () => {
  it("parses the strict discriminated create contract", () => {
    expect(
      parseEmailSignaturePutOperation({
        content: { htmlBody: "<p>Regards</p>", mode: "rich" },
        expectedRevision: null,
        name: "Work",
        operation: "create",
      }),
    ).toEqual({
      content: { htmlBody: "<p>Regards</p>", mode: "rich" },
      expectedRevision: null,
      name: "Work",
      operation: "create",
    });
  });

  it.each([
    {
      content: { body: "Regards", mode: "plain" },
      expectedRevision: null,
      name: "Work",
      operation: "create",
      ownerEmail: "victim@example.com",
    },
    {
      content: {
        body: "plain must not accompany rich",
        htmlBody: "<p>Rich</p>",
        mode: "rich",
      },
      expectedRevision: null,
      name: "Work",
      operation: "create",
    },
    {
      content: { body: "Regards", mode: "plain" },
      expectedRevision: null,
      name: "unsafe\u202ename",
      operation: "create",
    },
    {
      content: { body: "Regards", mode: "plain" },
      expectedRevision: null,
      name: "two\nlines",
      operation: "create",
    },
  ])("rejects unknown, divergent, or unsafe input", (input) => {
    expect(() => parseEmailSignaturePutOperation(input)).toThrow();
  });
});

describe("email signature content policy", () => {
  it("uses the outgoing sanitizer and derives the plain variant", () => {
    const content = canonicalizeEmailSignatureContent({
      htmlBody:
        '<p style="background:url(https://tracker.invalid)">' +
        "<b>Regards</b> " +
        '<a href="https://example.com">Website</a>' +
        '<img src="https://tracker.invalid/pixel" onerror="alert(1)">' +
        "<script>SECRET()</script></p>",
      mode: "rich",
    });

    expect(content).toEqual({
      body: "Regards Website [https://example.com/]",
      htmlBody:
        '<p><strong>Regards</strong> ' +
        '<a href="https://example.com/" rel="noopener noreferrer" target="_blank">Website</a></p>',
    });
    expect(JSON.stringify(content)).not.toMatch(
      /(?:SECRET|tracker\.invalid|<img|onerror|style=)/iu,
    );
  });

  it("accepts the exact field limit and rejects the next character", () => {
    expect(
      canonicalizeEmailSignatureContent({
        body: "a".repeat(MAX_EMAIL_SIGNATURE_CONTENT_CHARACTERS),
        mode: "plain",
      }).body,
    ).toHaveLength(MAX_EMAIL_SIGNATURE_CONTENT_CHARACTERS);
    expect(() =>
      canonicalizeEmailSignatureContent({
        body: "a".repeat(MAX_EMAIL_SIGNATURE_CONTENT_CHARACTERS + 1),
        mode: "plain",
      }),
    ).toThrow("safe content limit");
  });

  it("admits 256 rich nodes and rejects the 257th before canonicalization", () => {
    expect(
      canonicalizeEmailSignatureContent({
        htmlBody: "<p>x</p>".repeat(MAX_EMAIL_SIGNATURE_HTML_NODES),
        mode: "rich",
      }).htmlBody,
    ).toBe("<p>x</p>".repeat(MAX_EMAIL_SIGNATURE_HTML_NODES));
    expect(() =>
      canonicalizeEmailSignatureContent({
        htmlBody: "<span>x</span>".repeat(
          MAX_EMAIL_SIGNATURE_HTML_NODES + 1,
        ),
        mode: "rich",
      }),
    ).toThrow("too complex");
  });

  it("accepts depth 16 and rejects depth 17", () => {
    const nested = (depth: number) =>
      "<ol>".repeat(depth) + "<li>Deep</li>" + "</ol>".repeat(depth);
    expect(
      canonicalizeEmailSignatureContent({
        htmlBody: nested(MAX_EMAIL_SIGNATURE_HTML_DEPTH - 1),
        mode: "rich",
      }).body,
    ).toContain("Deep");
    expect(() =>
      canonicalizeEmailSignatureContent({
        htmlBody: nested(MAX_EMAIL_SIGNATURE_HTML_DEPTH),
        mode: "rich",
      }),
    ).toThrow("too complex");
  });

  it.each([
    "<script>Only active content</script>",
    '<img src="https://tracker.invalid/pixel">',
    "<p>unsafe\u0000content</p>",
  ])("fails closed for unreadable or unsafe rich input", (htmlBody) => {
    expect(() =>
      canonicalizeEmailSignatureContent({ htmlBody, mode: "rich" }),
    ).toThrow();
  });
});
