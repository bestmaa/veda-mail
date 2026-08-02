import { describe, expect, it } from "vitest";

import {
  MAX_EMAIL_TEMPLATE_CONTENT_CHARACTERS,
  MAX_EMAIL_TEMPLATE_HTML_DEPTH,
  MAX_EMAIL_TEMPLATE_HTML_NODES,
} from "@/domain/member/email-template";
import { canonicalizeEmailTemplateContent } from "@/server/templates/email-template-content";
import { parseEmailTemplatePutOperation } from "@/server/templates/email-template.schema";

describe("email template wire schema", () => {
  it("parses the strict discriminated create contract", () => {
    expect(
      parseEmailTemplatePutOperation({
        content: {
          htmlBody: "<p>Hello <b>team</b></p>",
          mode: "rich",
          subject: "Status update",
        },
        expectedRevision: null,
        name: "Weekly update",
        operation: "create",
      }),
    ).toEqual({
      content: {
        htmlBody: "<p>Hello <b>team</b></p>",
        mode: "rich",
        subject: "Status update",
      },
      expectedRevision: null,
      name: "Weekly update",
      operation: "create",
    });
  });

  it.each([
    {
      content: { body: "Hello", mode: "plain", subject: "Subject" },
      expectedRevision: null,
      name: "Owned by attacker",
      operation: "create",
      ownerEmail: "victim@example.com",
    },
    {
      content: {
        body: "plain must not accompany rich",
        htmlBody: "<p>Rich</p>",
        mode: "rich",
        subject: "Subject",
      },
      expectedRevision: null,
      name: "Divergent",
      operation: "create",
    },
    {
      content: {
        body: "Hello",
        mode: "plain",
        subject: "Injected\r\nBcc: victim@example.com",
      },
      expectedRevision: null,
      name: "Header injection",
      operation: "create",
    },
    {
      content: {
        body: "Hello",
        mode: "plain",
        subject: "Spoofed\u202esubject",
      },
      expectedRevision: null,
      name: "Bidi subject",
      operation: "create",
    },
    {
      content: {
        body: "Hello",
        mode: "plain",
        subject: "Malformed\ud800subject",
      },
      expectedRevision: null,
      name: "Malformed subject",
      operation: "create",
    },
    {
      content: { body: "Hello", mode: "plain", subject: "Subject" },
      expectedRevision: null,
      name: "unsafe\u202ename",
      operation: "create",
    },
    {
      content: { body: "Hello", mode: "plain", subject: "Subject" },
      expectedRevision: null,
      name: "two\nlines",
      operation: "create",
    },
    {
      expectedRevision: null,
      operation: "delete",
      templateId: "not-a-uuid",
    },
  ])("rejects mass assignment or unsafe input", (input) => {
    expect(() => parseEmailTemplatePutOperation(input)).toThrow();
  });
});

describe("email template content policy", () => {
  it("sanitizes rich HTML and derives the readable plain variant", () => {
    const content = canonicalizeEmailTemplateContent({
      htmlBody:
        '<p style="background:url(https://tracker.invalid)">' +
        "<b>Hello</b> " +
        '<a href="https://example.com">Website</a>' +
        '<img src="https://tracker.invalid/pixel" onerror="alert(1)">' +
        "<script>SECRET()</script></p>",
      mode: "rich",
      subject: "Status update",
    });

    expect(content).toEqual({
      body: "Hello Website [https://example.com/]",
      htmlBody:
        '<p><strong>Hello</strong> ' +
        '<a href="https://example.com/" rel="noopener noreferrer" target="_blank">Website</a></p>',
      subject: "Status update",
    });
    expect(JSON.stringify(content)).not.toMatch(
      /(?:SECRET|tracker\.invalid|<img|onerror|style=)/iu,
    );
  });

  it("accepts the exact field limit and rejects the next character", () => {
    expect(
      canonicalizeEmailTemplateContent({
        body: "a".repeat(MAX_EMAIL_TEMPLATE_CONTENT_CHARACTERS),
        mode: "plain",
        subject: "",
      }).body,
    ).toHaveLength(MAX_EMAIL_TEMPLATE_CONTENT_CHARACTERS);
    expect(() =>
      canonicalizeEmailTemplateContent({
        body: "a".repeat(MAX_EMAIL_TEMPLATE_CONTENT_CHARACTERS + 1),
        mode: "plain",
        subject: "",
      }),
    ).toThrow("safe content limit");
  });

  it("enforces rich node and depth limits before persistence", () => {
    expect(
      canonicalizeEmailTemplateContent({
        htmlBody: "<p>x</p>".repeat(MAX_EMAIL_TEMPLATE_HTML_NODES),
        mode: "rich",
        subject: "",
      }).htmlBody,
    ).toBe("<p>x</p>".repeat(MAX_EMAIL_TEMPLATE_HTML_NODES));
    expect(() =>
      canonicalizeEmailTemplateContent({
        htmlBody: "<span>x</span>".repeat(MAX_EMAIL_TEMPLATE_HTML_NODES + 1),
        mode: "rich",
        subject: "",
      }),
    ).toThrow("too complex");

    const nested = (depth: number) =>
      "<ol>".repeat(depth) + "<li>Deep</li>" + "</ol>".repeat(depth);
    expect(
      canonicalizeEmailTemplateContent({
        htmlBody: nested(MAX_EMAIL_TEMPLATE_HTML_DEPTH - 1),
        mode: "rich",
        subject: "",
      }).body,
    ).toContain("Deep");
    expect(() =>
      canonicalizeEmailTemplateContent({
        htmlBody: nested(MAX_EMAIL_TEMPLATE_HTML_DEPTH),
        mode: "rich",
        subject: "",
      }),
    ).toThrow("too complex");
  });

  it.each([
    "<script>Only active content</script>",
    '<img src="https://tracker.invalid/pixel">',
    "<p>unsafe\u0000content</p>",
  ])("fails closed for unreadable or unsafe rich input", (htmlBody) => {
    expect(() =>
      canonicalizeEmailTemplateContent({
        htmlBody,
        mode: "rich",
        subject: "",
      }),
    ).toThrow();
  });
});
