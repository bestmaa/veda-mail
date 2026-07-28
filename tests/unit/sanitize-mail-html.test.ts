import { describe, expect, it } from "vitest";

import { sanitizeMailHtml } from "@/infrastructure/providers/sanitize-mail-html";

const maliciousCorpus = [
  "<script>alert(document.cookie)</script><p>Safe</p>",
  '<img src="https://tracker.example/pixel" onerror="alert(1)">',
  '<svg><animate onbegin="alert(1)"></animate></svg>',
  '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
  '<form action="https://evil.example"><input name="password"></form>',
  '<meta http-equiv="refresh" content="0;url=https://evil.example">',
  '<a href="javascript:alert(1)">Open</a>',
  '<a href="data:text/html,<script>alert(1)</script>">Open</a>',
  '<a href="//evil.example/path">Protocol relative</a>',
  '<a href="/api/v1/member/settings">Relative internal link</a>',
  '<a href="#account-settings-title">Fragment link</a>',
  '<p style="background:url(https://tracker.example)">Styled</p>',
  '<math><mtext><table><mglyph><style><!--</style>' +
    '<img title="--><img src=x onerror=alert(1)>">',
  '<svg><p><style><a id="</style><img src=x onerror=alert(1)>">',
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>">Safe',
] as const;

describe("mail HTML sanitizer", () => {
  it.each(maliciousCorpus)("removes active content from %s", (input) => {
    const output = sanitizeMailHtml(input);

    expect(output).not.toMatch(
      /(?:<script|<iframe|<form|<input|<img|<svg|<meta|onerror|onbegin|style=)/i,
    );
    expect(output).not.toMatch(/(?:javascript:|data:|href="\/\/)/i);
  });

  it("preserves the bounded formatting and link allowlist", () => {
    expect(
      sanitizeMailHtml(
        '<h2>Update</h2><p><strong>Ready</strong> ' +
          '<a href="https://example.com" title="Details">View</a></p>' +
          '<table><tr><th colspan="2">Status</th></tr></table>',
      ),
    ).toBe(
      '<h2>Update</h2><p><strong>Ready</strong> ' +
        '<a href="https://example.com" rel="noopener noreferrer" target="_blank" title="Details">View</a></p>' +
        '<table><tr><th colspan="2">Status</th></tr></table>',
    );
  });

  it("forces safe new-tab isolation on sender-controlled links", () => {
    expect(
      sanitizeMailHtml(
        '<a href="https://example.com" target="_self" rel="opener">Open</a>',
      ),
    ).toBe(
      '<a href="https://example.com" rel="noopener noreferrer" target="_blank">Open</a>',
    );
  });

  it("removes relative links that could navigate within Veda Mail", () => {
    expect(
      sanitizeMailHtml(
        '<a href="/api/v1/member/settings">Internal</a>' +
          '<a href="#profile">Fragment</a>',
      ),
    ).toBe("<a>Internal</a><a>Fragment</a>");
  });

  it.each(maliciousCorpus)(
    "is idempotent after reparsing hostile markup from %s",
    (input) => {
      const sanitized = sanitizeMailHtml(input);

      expect(sanitizeMailHtml(sanitized)).toBe(sanitized);
      expect(sanitized).not.toMatch(
        /(?:<script|<iframe|<form|<input|<img|<svg|<math|<meta|<style|on\w+\s*=)/i,
      );
    },
  );
});
