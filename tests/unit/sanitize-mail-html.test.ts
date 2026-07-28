import { describe, expect, it } from "vitest";

import {
  mailHtmlToPlainText,
  sanitizeMailHtml,
} from "@/infrastructure/providers/sanitize-mail-html";

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

describe("mail HTML plain-text conversion", () => {
  it("preserves semantic blocks and line breaks while decoding entities", () => {
    expect(
      mailHtmlToPlainText(
        "<h1>Welcome</h1>" +
          "<p>First &amp; second<br>Next&nbsp;line</p>" +
          "<ul><li>One</li><li>Two</li></ul>",
      ),
    ).toBe("Welcome\nFirst & second\nNext line\nOne\nTwo");
  });

  it("drops script and style contents before parser-backed conversion", () => {
    expect(
      mailHtmlToPlainText(
        "<script>SECRET_SCRIPT()</script>" +
          "<style>.SECRET_STYLE{display:none}</style>" +
          "<iframe>SECRET_FRAME</iframe>" +
          "<template>SECRET_TEMPLATE</template>" +
          "<head><title>SECRET_TITLE</title></head>" +
          "<p>Visible &amp; safe<br>Next line</p>",
      ),
    ).toBe("Visible & safe\nNext line");
  });

  it("cannot re-form executable markup from nested malformed tags", () => {
    const output = mailHtmlToPlainText(
      "<scr<script>ipt>MUTATION_SCRIPT()</scr</script>ipt>" +
        "<p>Visible &amp; safe<br>Next line</p>",
    );

    expect(output).not.toMatch(/<script/i);
    expect(output).toContain("Visible & safe\nNext line");
  });

  it("handles mutation-style foreign markup without leaking active content", () => {
    const output = mailHtmlToPlainText(
      "<math><mtext><table><mglyph><style><!--</style>" +
        '<img title="--><img src=x onerror=TRACKER_LEAK()>">' +
        "</mglyph></table></mtext></math>" +
        "<p>Readable &amp; safe<br>Second line</p>",
    );

    expect(output).not.toMatch(/(?:TRACKER_LEAK|<script|<style)/i);
    expect(output).toContain("Readable & safe\nSecond line");
  });

  it("bounds hostile table spans and deeply nested allowed tags", () => {
    const deeplyNested =
      "<div>".repeat(5_000) + "Deep content" + "</div>".repeat(5_000);
    const output = mailHtmlToPlainText(
      '<table><tr><td colspan="10000" rowspan="10000">Cell</td></tr></table>' +
        deeplyNested,
    );

    expect(output).toContain("Cell");
    expect(output).toContain("Deep content");
    expect(output.length).toBeLessThan(100);
  });

  it("bounds parser input and child-node expansion", () => {
    const manyChildren = "<span>x</span>".repeat(2_500);
    const oversized = "y".repeat(1_100_000);
    const output = mailHtmlToPlainText(
      `<div>${manyChildren}</div><p>${oversized}</p>UNREACHABLE_TAIL`,
    );

    expect(output).not.toContain("UNREACHABLE_TAIL");
    expect(output.length).toBeLessThanOrEqual(256_000);
  });

  it("prevents formatter output amplification near the input limit", () => {
    const denseRules = Array.from(
      { length: 64 },
      () => `<div>${"<hr>".repeat(1_000)}</div>`,
    ).join("");
    const nestedLists =
      "<ul><li>".repeat(10_000) + "Item" + "</li></ul>".repeat(10_000);
    const output = mailHtmlToPlainText(nestedLists + denseRules);

    expect(output).toContain("Item");
    expect(output.length).toBeLessThanOrEqual(256_000);
    expect(output.length).toBeLessThan(denseRules.length + nestedLists.length);
  });
});
