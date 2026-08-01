import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AttachmentCardView } from "@/presentation/features/mail-workspace/ui/attachment-card.view";

describe("attachment card component", () => {
  it("renders an accessible scoped download action", () => {
    const html = renderToStaticMarkup(
      createElement(AttachmentCardView, {
        attachment: {
          error: null,
          href: "/api/v1/mail/messages/message%2F1/attachments/attachment%3F1",
          id: "attachment?1",
          isDownloading: false,
          isPreviewing: false,
          meta: "application/pdf - 24 KiB",
          name: "quarterly report.pdf",
          onDownload: () => undefined,
          onPreview: null,
        },
      }),
    );

    expect(html).toContain("<button");
    expect(html).toContain('aria-label="Download quarterly report.pdf"');
    expect(html).toContain('type="button"');
    expect(html).toContain("focus-visible:outline-indigo-600");
    expect(html).toContain("Download</button>");
    expect(html).not.toContain("target=");
  });

  it("keeps preview an explicit button separate from download", () => {
    const html = renderToStaticMarkup(
      createElement(AttachmentCardView, {
        attachment: {
          error: null,
          href: "/api/v1/mail/messages/message-one/attachments/text-one",
          id: "text-one",
          isDownloading: false,
          isPreviewing: false,
          meta: "text/plain - 12 B",
          name: "notes.txt",
          onDownload: () => undefined,
          onPreview: () => undefined,
        },
      }),
    );

    expect(html).toContain('aria-label="Preview notes.txt"');
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="Download notes.txt"');
    expect(html.match(/type="button"/gu)).toHaveLength(2);
  });

  it("exposes busy state and local download feedback without a focusable card", () => {
    const html = renderToStaticMarkup(createElement(AttachmentCardView, {
      attachment: {
        error: null,
        href: "/download",
        id: "busy",
        isDownloading: true,
        isPreviewing: true,
        meta: "text/plain · 12 B",
        name: "notes.txt",
        onDownload: () => undefined,
        onPreview: () => undefined,
      },
    }));

    expect(html.match(/aria-busy="true"/gu)).toHaveLength(2);
    expect(html).toContain('role="status"');
    expect(html).toContain("Downloading notes.txt…");
    expect(html).toContain("overflow-wrap:anywhere");
    expect(html).not.toContain("tabindex=");
  });

  it("renders download failure beside its action", () => {
    const html = renderToStaticMarkup(createElement(AttachmentCardView, {
      attachment: {
        error: "Unable to download this attachment.",
        href: "/download",
        id: "failed",
        isDownloading: false,
        isPreviewing: false,
        meta: "application/pdf · 1 KB",
        name: "report.pdf",
        onDownload: () => undefined,
        onPreview: null,
      },
    }));

    expect(html).toContain('role="alert"');
    expect(html).toContain("Unable to download this attachment.");
    expect(html).toContain('aria-describedby="attachment-failed-download-feedback"');
  });
});
