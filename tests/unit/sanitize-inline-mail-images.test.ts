import { describe, expect, it } from "vitest";

import { MAX_RENDERABLE_RECEIVED_INLINE_IMAGES } from "@/domain/mail/inline-image";
import { id } from "@/domain/shared/brand";
import { sanitizeMailHtml } from "@/infrastructure/providers/sanitize-mail-html";
import { renderedInlineImageAttachmentIds } from "@/infrastructure/providers/sanitize-inline-mail-images";

describe("mail HTML inline-image sanitizer", () => {
  it("replaces only a verified CID raster reference with an opaque marker", () => {
    const output = sanitizeMailHtml(
      '<p><img src="CID:%3Clogo%40example.com%3E" ' +
        'alt=" Brand&#13;&#10;logo " title="Company logo" ' +
        'srcset="https://tracker.example/2x 2x" ' +
        'style="background:url(https://tracker.example/pixel)" ' +
        'onerror="alert(1)"></p>',
      {
        inlineImages: [
          {
            attachmentId: id.attachment("opaque-inline-image"),
            contentId: "logo@example.com",
          },
        ],
      },
    );

    expect(output).toContain(
      'data-veda-inline-image="opaque-inline-image"',
    );
    expect(output).toContain('alt="Brand  logo"');
    expect(output).toContain('title="Company logo"');
    expect(output).not.toMatch(
      /(?:\ssrc=|\ssrcset=|\sstyle=|\sonerror=|https:\/\/tracker)/iu,
    );
  });

  it("removes unverified remote, data, blob, and unknown CID images", () => {
    const output = sanitizeMailHtml(
      '<img src="https://tracker.example/pixel">' +
        '<img src="data:image/png;base64,AAAA">' +
        '<img src="blob:https://mail.example/id">' +
        '<img src="cid:unknown@example.com">',
      {
        inlineImages: [
          {
            attachmentId: id.attachment("opaque-inline-image"),
            contentId: "logo@example.com",
          },
        ],
      },
    );

    expect(output).not.toContain("<img");
    expect(output).not.toContain("data-veda-inline-image");
  });

  it("fails closed when a Content-ID maps to multiple attachments", () => {
    const output = sanitizeMailHtml(
      '<img src="cid:duplicate@example.com" alt="Ambiguous">',
      {
        inlineImages: [
          {
            attachmentId: id.attachment("first-inline-image"),
            contentId: "duplicate@example.com",
          },
          {
            attachmentId: id.attachment("second-inline-image"),
            contentId: "duplicate@example.com",
          },
        ],
      },
    );

    expect(output).not.toContain("<img");
  });

  it("removes sender-supplied opaque markers without a verified mapping", () => {
    expect(
      sanitizeMailHtml(
        '<img data-veda-inline-image="guessed-id" alt="Injected">',
      ),
    ).toBe("");
  });

  it("extracts only sanitized opaque markers for presentation fallback", () => {
    const sanitized = sanitizeMailHtml(
      '<img src="cid:logo@example.com" alt="Logo">',
      {
        inlineImages: [
          {
            attachmentId: id.attachment("opaque-inline-image"),
            contentId: "logo@example.com",
          },
        ],
      },
    );

    expect([...renderedInlineImageAttachmentIds(sanitized)]).toEqual([
      "opaque-inline-image",
    ]);
    expect(
      renderedInlineImageAttachmentIds(null),
    ).toEqual(new Set());
  });

  it("is idempotent for verified opaque inline-image markers", () => {
    const options = {
      inlineImages: [
        {
          attachmentId: id.attachment("opaque-inline-image"),
          contentId: "logo@example.com",
        },
      ],
    } as const;
    const sanitized = sanitizeMailHtml(
      '<img src="cid:logo@example.com" alt="Logo">',
      options,
    );

    expect(sanitizeMailHtml(sanitized, options)).toBe(sanitized);
    expect(sanitized).not.toContain("src=");
  });

  it("caps the number of renderable inline images per message", () => {
    const inlineImages = Array.from({ length: 20 }, (_, index) => ({
      attachmentId: id.attachment(`opaque-inline-image-${index}`),
      contentId: `image-${index}@example.com`,
    }));
    const output = sanitizeMailHtml(
      inlineImages
        .map(
          ({ contentId }) =>
            `<img src="cid:${contentId}" alt="Inline image">`,
        )
        .join(""),
      { inlineImages },
    );

    expect(output.match(/data-veda-inline-image=/gu)).toHaveLength(
      MAX_RENDERABLE_RECEIVED_INLINE_IMAGES,
    );
    expect(output.match(/<img\b/gu)).toHaveLength(
      MAX_RENDERABLE_RECEIVED_INLINE_IMAGES,
    );
    expect(output).not.toContain(
      `opaque-inline-image-${MAX_RENDERABLE_RECEIVED_INLINE_IMAGES}`,
    );
  });

  it("finds a valid referenced candidate after the first 32 entries", () => {
    const inlineImages = Array.from({ length: 33 }, (_, index) => ({
      attachmentId: id.attachment(`opaque-inline-image-${index}`),
      contentId: `image-${index}@example.com`,
    }));
    const output = sanitizeMailHtml(
      '<img src="cid:image-32@example.com" alt="Late candidate">',
      { inlineImages },
    );

    expect(output).toContain(
      'data-veda-inline-image="opaque-inline-image-32"',
    );
  });

  it("preserves valid long Content-IDs within the mail header limit", () => {
    const contentId = `${"a".repeat(900)}@example.com`;
    const output = sanitizeMailHtml(
      `<img src="cid:${contentId}" alt="Long identifier">`,
      {
        inlineImages: [
          {
            attachmentId: id.attachment("long-content-id-image"),
            contentId,
          },
        ],
      },
    );

    expect(output).toContain(
      'data-veda-inline-image="long-content-id-image"',
    );
  });

  it("fails closed when a duplicate appears after the first 32 entries", () => {
    const inlineImages = [
      {
        attachmentId: id.attachment("first-duplicate"),
        contentId: "duplicate@example.com",
      },
      ...Array.from({ length: 31 }, (_, index) => ({
        attachmentId: id.attachment(`filler-${index}`),
        contentId: `filler-${index}@example.com`,
      })),
      {
        attachmentId: id.attachment("late-duplicate"),
        contentId: "duplicate@example.com",
      },
    ];
    const output = sanitizeMailHtml(
      '<img src="cid:duplicate@example.com" alt="Ambiguous">',
      { inlineImages },
    );

    expect(output).not.toContain("<img");
  });
});
