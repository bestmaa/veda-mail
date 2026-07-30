import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AttachmentPreviewDialogView } from "@/presentation/features/mail-workspace/ui/attachment-preview-dialog.view";

describe("attachment preview dialog", () => {
  it("renders a script-disabled sandboxed plain-text blob frame", () => {
    const html = renderToStaticMarkup(
      createElement(AttachmentPreviewDialogView, {
        error: null,
        isLoading: false,
        isOpen: true,
        name: 'notes"><script>alert(1)</script>.txt',
        onClose: () => undefined,
        url: "blob:https://mail.example/opaque-preview",
      }),
    );

    expect(html).toContain("<dialog");
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("<iframe");
    expect(html).toContain('sandbox="allow-same-origin"');
    expect(html).not.toContain("allow-scripts");
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).toContain(
      'src="blob:https://mail.example/opaque-preview"',
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("allow=");
    expect(html).not.toContain("srcDoc=");
  });

  it("shows scanner progress and no frame before bytes are approved", () => {
    const html = renderToStaticMarkup(
      createElement(AttachmentPreviewDialogView, {
        error: null,
        isLoading: true,
        isOpen: true,
        name: "notes.txt",
        onClose: () => undefined,
        url: null,
      }),
    );

    expect(html).toContain("Scanning and checking this attachment");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("<iframe");
  });
});
