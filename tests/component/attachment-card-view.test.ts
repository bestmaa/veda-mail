import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AttachmentCardView } from "@/presentation/features/mail-workspace/ui/attachment-card.view";

describe("attachment card component", () => {
  it("renders an accessible scoped download action", () => {
    const html = renderToStaticMarkup(
      createElement(AttachmentCardView, {
        attachment: {
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
});
