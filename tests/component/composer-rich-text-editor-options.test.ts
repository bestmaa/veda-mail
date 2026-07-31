import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ComposerRichTextEditorConnector } from "@/presentation/features/mail-workspace/connectors/composer-rich-text-editor.connector";

describe("composer rich editor options", () => {
  it("supports reusable signature-settings labels and requirements", () => {
    const html = renderToStaticMarkup(
      createElement(ComposerRichTextEditorConnector, {
        autoFocus: false,
        disabled: false,
        initialHtml: "",
        label: "Signature body",
        namespace: "VedaMailSignatureSettings",
        onChange: vi.fn(),
        placeholder: "Write your signature…",
        required: false,
      }),
    );

    expect(html).toContain('aria-label="Signature body"');
    expect(html).toContain('aria-required="false"');
    expect(html).toContain("Write your signature…");
  });
});
