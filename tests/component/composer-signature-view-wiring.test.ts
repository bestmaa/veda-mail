import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { id } from "@/domain/shared/brand";
import type { ComposerBodyViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";
import { ComposerBodyView } from "@/presentation/features/mail-workspace/ui/composer-body.view";

const signatureId = id.signature("work");
const signature = {
  initialContentPlacement: "prefix" as const,
  onSelectedIdChange: vi.fn(),
  options: [
    {
      body: "Regards,\nAda",
      id: signatureId,
      name: "Work",
    },
  ],
  selectedId: signatureId,
};

const body = (
  overrides: Partial<ComposerBodyViewModel> = {},
): ComposerBodyViewModel => ({
  cancelPlainMode: vi.fn(),
  confirmPlainMode: vi.fn(),
  editorVersion: 0,
  html: "",
  isPlainModeWarningOpen: false,
  mode: "rich",
  onPlainDrop: vi.fn(),
  onPlainInput: vi.fn(),
  onPlainPaste: vi.fn(),
  onRichChange: vi.fn(),
  onRichInitialize: vi.fn(),
  onToggleMode: vi.fn(),
  onWarningKeyDown: vi.fn(),
  plainTransferStatus: "",
  signature,
  signatureAnnouncement: "",
  signatureDetached: false,
  text: "",
  ...overrides,
});

const render = (model: ComposerBodyViewModel): string =>
  renderToStaticMarkup(
    createElement(ComposerBodyView, {
      body: model,
      focusBody: false,
      isSending: false,
    }),
  );

describe("composer signature view wiring", () => {
  it("renders the configured picker only in structured rich mode", () => {
    const rich = render(body());
    const plain = render(
      body({
        mode: "plain",
        signatureDetached: true,
        text: "Regards,\nAda",
      }),
    );

    expect(rich).toContain('aria-label="Email signature"');
    expect(rich).toContain('<option value="work" selected="">Work</option>');
    expect(plain).not.toContain('aria-label="Email signature"');
    expect(plain).toContain("Signature is now editable message text");
  });

  it("keeps the detached notice while rich mode remains picker-free", () => {
    const html = render(
      body({
        mode: "rich",
        signature: null,
        signatureAnnouncement:
          "Signature converted to editable plain text.",
        signatureDetached: true,
        text: "Regards,\nAda",
      }),
    );

    expect(html).not.toContain('aria-label="Email signature"');
    expect(html).toContain("Signature is now editable message text");
    expect(html).toContain("Signature converted to editable plain text.");
  });
});
