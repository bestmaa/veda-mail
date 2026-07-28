import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ComposerViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";
import { ComposerView } from "@/presentation/features/mail-workspace/ui/composer.view";

const composer = (
  overrides: Partial<ComposerViewModel> = {},
): ComposerViewModel => ({
  bcc: "",
  bccInput: vi.fn(),
  body: "",
  bodyInput: vi.fn(),
  cc: "",
  ccInput: vi.fn(),
  error: null,
  focusBody: false,
  isOpen: true,
  isSending: false,
  onClose: vi.fn(),
  onSubmit: vi.fn(),
  onToggleBcc: vi.fn(),
  onToggleCc: vi.fn(),
  showBcc: false,
  showCc: false,
  subject: "",
  subjectInput: vi.fn(),
  title: "New message",
  to: "",
  toInput: vi.fn(),
  ...overrides,
});

const renderComposer = (model: ComposerViewModel): string =>
  renderToStaticMarkup(createElement(ComposerView, { composer: model }));

describe("composer component", () => {
  it("renders nothing while closed", () => {
    expect(renderComposer(composer({ isOpen: false }))).toBe("");
  });

  it("exposes disclosure state and keeps To optional", () => {
    const html = renderComposer(composer());

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="Compose message"');
    expect(html).toContain('aria-controls="composer-cc-row"');
    expect(html).toContain('aria-controls="composer-bcc-row"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('hidden="" id="composer-cc-row"');
    expect(html).toContain('hidden="" id="composer-bcc-row"');
    expect(html).not.toMatch(/id="composer-to"[^>]*required/);
  });

  it("renders visible recipients and locks sending controls", () => {
    const html = renderComposer(
      composer({
        bcc: "hidden@example.com",
        cc: "copy@example.com",
        isSending: true,
        showBcc: true,
        showCc: true,
      }),
    );

    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toContain('hidden="" id="composer-cc-row"');
    expect(html).not.toContain('hidden="" id="composer-bcc-row"');
    expect(html).toContain("Sending…");
    expect(html.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(7);
  });
});
