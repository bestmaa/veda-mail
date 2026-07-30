import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { AttachmentViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";
import { ReceivedAttachmentListView } from "@/presentation/features/mail-workspace/ui/received-attachment-list.view";

const attachment = (
  id: string,
  name: string,
): AttachmentViewModel => ({
  href: `/api/v1/mail/messages/message-one/attachments/${id}`,
  id,
  isPreviewing: false,
  meta: "text/plain · 12 B",
  name,
  onPreview: () => undefined,
});

const render = (
  attachments: readonly AttachmentViewModel[],
  downloadAll: {
    readonly isPreparing: boolean;
    readonly onClick: () => void;
  } | null = { isPreparing: false, onClick: () => undefined },
) =>
  renderToStaticMarkup(
    createElement(ReceivedAttachmentListView, {
      attachments,
      downloadAll,
    }),
  );

describe("received attachment list component", () => {
  it("renders one preflighted archive action and keeps individual cards", () => {
    const html = render([
      attachment("first", "first.txt"),
      attachment("second", "second.txt"),
    ]);

    expect(html).toContain('aria-labelledby="received-attachments-title"');
    expect(html).toContain(
      'aria-label="Download all 2 attachments as a ZIP file"',
    );
    expect(html).toContain('type="button"');
    expect(html).toContain("h-11");
    expect(html).toContain("flex-wrap");
    expect(html).toContain("focus-visible:outline-indigo-600");
    expect(html).toContain("Download first.txt");
    expect(html).toContain("Download second.txt");
    expect(html).not.toContain('download="attachments.zip"');
  });

  it("omits download all for zero or one attachment", () => {
    expect(render([], null)).toBe("");
    const html = render([attachment("only", "only.txt")]);

    expect(html).toContain("Download only.txt");
    expect(html).not.toContain("Download all");
    expect(html).not.toContain("Preparing ZIP");
  });

  it("omits download all when no safe route is available", () => {
    const html = render(
      [
        attachment("first", "first.txt"),
        attachment("second", "second.txt"),
      ],
      null,
    );

    expect(html).not.toContain("Download all");
    expect(html).toContain("Download first.txt");
    expect(html).toContain("Download second.txt");
  });
});
