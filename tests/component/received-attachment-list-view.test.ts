import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { AttachmentViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";
import { ReceivedAttachmentListView } from "@/presentation/features/mail-workspace/ui/received-attachment-list.view";

const attachment = (
  id: string,
  name: string,
): AttachmentViewModel => ({
  error: null,
  href: `/api/v1/mail/messages/message-one/attachments/${id}`,
  id,
  isDownloading: false,
  isPreviewing: false,
  meta: "text/plain · 12 B",
  name,
  onDownload: () => undefined,
  onPreview: () => undefined,
});

const render = (
  attachments: readonly AttachmentViewModel[],
  downloadAll: {
    readonly error: string | null;
    readonly isPreparing: boolean;
    readonly onClick: () => void;
  } | null = { error: null, isPreparing: false, onClick: () => undefined },
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

  it("announces archive preparation and failures beside Download all", () => {
    const attachments = [
      attachment("first", "first.txt"),
      attachment("second", "second.txt"),
    ];
    const preparing = render(attachments, {
      error: null, isPreparing: true, onClick: () => undefined,
    });
    const failed = render(attachments, {
      error: "Archive preparation failed.",
      isPreparing: false,
      onClick: () => undefined,
    });

    expect(preparing).toContain('aria-busy="true"');
    expect(preparing).toContain('role="status"');
    expect(preparing).toContain(
      "Scanning and preparing all attachments before download…",
    );
    expect(preparing).not.toContain("Safe");
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("Archive preparation failed.");
  });
});
