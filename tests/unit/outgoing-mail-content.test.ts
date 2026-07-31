import { describe, expect, it } from "vitest";

import { hasCanonicalDraftContent } from "@/domain/mail/draft-content-round-trip";
import {
  canonicalizeDraftMailContent,
  canonicalizeOutgoingMailContent,
} from "@/server/mail/outgoing-mail-content";

const canonicalDraft = {
  bcc: [],
  body: "Quoted",
  cc: [],
  subject: "Subject",
  to: [{ email: "reader@example.com", name: null }],
};

describe("outgoing mail content", () => {
  it.each([
    { body: " Quoted " },
    { body: "Quoted", htmlBody: "<blockquote>Quoted</blockquote>" },
    { body: "Cell", htmlBody: "<table><tr><td>Cell</td></tr></table>" },
  ])("marks non-round-tripping provider content read-only", (content) => {
    expect(hasCanonicalDraftContent({ ...canonicalDraft, ...content })).toBe(
      false,
    );
  });

  it("accepts exact outgoing-canonical provider content", () => {
    expect(
      hasCanonicalDraftContent({
        ...canonicalDraft,
        htmlBody: "<p>Quoted</p>",
      }),
    ).toBe(true);
  });

  it.each([
    { ...canonicalDraft, subject: " Subject " },
    {
      ...canonicalDraft,
      to: [{ email: " reader@example.com ", name: " Reader " }],
    },
    {
      ...canonicalDraft,
      cc: [{ email: "READER@example.com", name: null }],
    },
  ])("marks request-normalized provider metadata read-only", (content) => {
    expect(hasCanonicalDraftContent(content)).toBe(false);
  });

  it("canonicalizes blank and partial drafts without weakening rich safety", () => {
    expect(canonicalizeDraftMailContent({ body: " \n " })).toEqual({
      body: "",
    });
    expect(
      canonicalizeDraftMailContent({
        body: "untrusted fallback",
        htmlBody: "<script>only active content</script>",
      }),
    ).toEqual({ body: "" });
    expect(
      canonicalizeDraftMailContent({
        body: "untrusted fallback",
        htmlBody: "<p>Hello <b>team</b></p><script>private()</script>",
      }),
    ).toEqual({
      body: "Hello team",
      htmlBody: "<p>Hello <strong>team</strong></p>",
    });
  });

  it("preserves the existing plain-text-only contract", () => {
    expect(
      canonicalizeOutgoingMailContent({ body: "  Plain message  " }),
    ).toEqual({ body: "Plain message" });
  });

  it("sanitizes rich HTML and derives its provider-bound plain alternative", () => {
    const content = canonicalizeOutgoingMailContent({
      body: "A client-supplied fallback is not trusted.",
      htmlBody:
        "<h1>Update</h1>" +
        '<p style="background:url(https://tracker.invalid)">' +
        "<b>Ready</b> <i>now</i> " +
        '<a href="https://example.com">View</a>' +
        '<img src="https://tracker.invalid/pixel" onerror="alert(1)">' +
        "<script>SECRET_SCRIPT()</script></p>" +
        "<ul><li>One</li><li>Two</li></ul>",
    });

    expect(content.htmlBody).toBe(
      "<h1>Update</h1><p><strong>Ready</strong> <em>now</em> " +
        '<a href="https://example.com/" rel="noopener noreferrer" target="_blank">View</a>' +
        "</p><ul><li>One</li><li>Two</li></ul>",
    );
    expect(content.body).toContain("Update");
    expect(content.body).toContain("Ready now View [https://example.com/]");
    expect(content.body).toContain("One");
    expect(content.body).toContain("Two");
    expect(content.body).not.toContain("client-supplied");
    expect(JSON.stringify(content)).not.toMatch(
      /(?:SECRET_SCRIPT|tracker\.invalid|<script|<img|style=|onerror)/iu,
    );
  });

  it("canonicalizes aliases and is idempotent on canonical provider content", () => {
    const first = canonicalizeOutgoingMailContent({
      body: "fallback",
      htmlBody: "<p><b>Bold</b> and <i>emphasis</i></p>",
    });

    expect(first.htmlBody).toBe(
      "<p><strong>Bold</strong> and <em>emphasis</em></p>",
    );
    expect(canonicalizeOutgoingMailContent(first)).toEqual(first);
  });

  it("keeps paragraph, line, list, and link meaning in the plain fallback", () => {
    const content = canonicalizeOutgoingMailContent({
      body: "fallback",
      htmlBody:
        "<p>Intro<br>Next</p>" +
        "<ul><li>One</li><li>Two</li></ul>" +
        "<ol><li>First</li><li>Second</li></ol>" +
        '<p><a href="mailto:team@example.com">Email the team</a></p>',
    });

    expect(content.body).toContain("Intro\nNext");
    expect(content.body).toMatch(/\*\s+One/u);
    expect(content.body).toMatch(/1\.\s+First/u);
    expect(content.body).toContain("Email the team [team@example.com]");
  });

  it("removes unsafe, relative, and protocol-relative link destinations", () => {
    const content = canonicalizeOutgoingMailContent({
      body: "fallback",
      htmlBody:
        '<p><a href="javascript:alert(1)">Script</a> ' +
        '<a href="/api/v1/member/settings">Relative</a> ' +
        '<a href="//tracker.invalid/path">Protocol relative</a> ' +
        '<a href="https://user:pass@example.com">Credentials</a> ' +
        '<a href="mailto:team@example.com?body=secret">Mail parameters</a> ' +
        '<a href="mailto:te%E2%80%AEam@example.com">Bidi mail</a></p>',
    });

    expect(content.htmlBody).toBe(
      "<p><a>Script</a> <a>Relative</a> <a>Protocol relative</a> " +
        "<a>Credentials</a> <a>Mail parameters</a> <a>Bidi mail</a></p>",
    );
    expect(content.body).toBe(
      "Script Relative Protocol relative Credentials Mail parameters Bidi mail",
    );
  });

  it.each([
    ["NUL", "safe\u0000unsafe"],
    ["C1 control", "safe\u0085unsafe"],
    ["bidi override", "safe\u202eunsafe"],
    ["unpaired high surrogate", "safe\ud800unsafe"],
    ["trailing unpaired high surrogate", "safe\ud800"],
    ["unpaired low surrogate", "safe\udc00unsafe"],
  ])("rejects %s instead of replacing it", (_label, body) => {
    expect(() => canonicalizeOutgoingMailContent({ body })).toThrow(
      "invalid or unsupported content",
    );
  });

  it("rejects code-unit and UTF-8 byte overflow without truncating", () => {
    expect(() =>
      canonicalizeOutgoingMailContent({ body: "a".repeat(256_001) }),
    ).toThrow("safe content limit");
    expect(() =>
      canonicalizeOutgoingMailContent({ body: "😀".repeat(64_001) }),
    ).toThrow("safe content limit");
  });

  it("rejects excessive element count and nesting depth", () => {
    expect(() =>
      canonicalizeOutgoingMailContent({
        body: "fallback",
        htmlBody: "<br>".repeat(1_001),
      }),
    ).toThrow("too complex");
    expect(() =>
      canonicalizeOutgoingMailContent({
        body: "fallback",
        htmlBody: "<ol>".repeat(33) + "<li>Deep</li>" + "</ol>".repeat(33),
      }),
    ).toThrow("too complex");
  });

  it("rejects an oversized link instead of truncating its destination", () => {
    expect(() =>
      canonicalizeOutgoingMailContent({
        body: "fallback",
        htmlBody: `<p><a href="https://example.com/${"a".repeat(2_048)}">Long</a></p>`,
      }),
    ).toThrow("safe content limit");
  });

  it.each([
    "<script>Only active content</script>",
    '<img src="https://tracker.invalid/pixel">',
    "<p><br></p>",
  ])(
    "rejects rich content without a readable plain alternative",
    (htmlBody) => {
      expect(() =>
        canonicalizeOutgoingMailContent({ body: "fallback", htmlBody }),
      ).toThrow("invalid or unsupported content");
    },
  );
});
