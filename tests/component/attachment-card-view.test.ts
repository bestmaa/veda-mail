import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AttachmentCardView } from "@/presentation/features/mail-workspace/ui/attachment-card.view";

describe("attachment card component", () => {
  it("renders an accessible, directly streamed download link", () => {
    const html = renderToStaticMarkup(
      createElement(AttachmentCardView, {
        attachment: {
          href: "/api/v1/mail/messages/message%2F1/attachments/attachment%3F1",
          id: "attachment?1",
          meta: "application/pdf - 24 KiB",
          name: "quarterly report.pdf",
        },
      }),
    );

    expect(html).toContain("<a");
    expect(html).toContain('aria-label="Download quarterly report.pdf"');
    expect(html).toContain('download=""');
    expect(html).toContain(
      'href="/api/v1/mail/messages/message%2F1/attachments/attachment%3F1"',
    );
    expect(html).toContain("focus-visible:outline-indigo-600");
    expect(html).toContain(">Download</span>");
    expect(html).not.toContain("target=");
  });
});
