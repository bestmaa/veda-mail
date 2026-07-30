import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ComposerViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";
import { ComposerView } from "@/presentation/features/mail-workspace/ui/composer.view";

const composer = (
  overrides: Partial<ComposerViewModel> = {},
): ComposerViewModel => ({
  attachmentCapabilityUnavailable: false,
  attachments: [],
  attachmentInput: vi.fn(),
  bcc: "",
  bccInput: vi.fn(),
  body: {
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
    onToggleMode: vi.fn(),
    onWarningKeyDown: vi.fn(),
    plainTransferStatus: "",
    signature: null,
    signatureAnnouncement: "",
    signatureDetached: false,
    text: "",
  },
  cc: "",
  ccInput: vi.fn(),
  error: null,
  focusBody: false,
  isAttachmentCapabilityRefreshing: false,
  isOpen: true,
  isSending: false,
  isUploading: false,
  maxAttachmentBytes: 18 * 1024 * 1024,
  onClose: vi.fn(),
  onRetryAttachmentCapability: vi.fn(),
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
  renderToStaticMarkup(
    createElement(ComposerView, { composer: model, deliveryNotice: null }),
  );

describe("composer component", () => {
  it("renders nothing while closed", () => {
    expect(renderComposer(composer({ isOpen: false }))).toBe("");
  });

  it("exposes disclosure state and keeps To optional", () => {
    const html = renderComposer(composer());

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="Compose message"');
    expect(html).toContain('role="toolbar"');
    expect(html).toContain('aria-label="Formatting options"');
    expect(html).toContain('aria-label="Switch to plain text"');
    expect(html).toContain('aria-keyshortcuts="Control+B Meta+B"');
    expect(html).toContain('aria-label="Message body"');
    expect(html).toContain('aria-multiline="true"');
    expect(html).toContain('aria-required="true"');
    expect(html).toContain('aria-controls="composer-cc-row"');
    expect(html).toContain('aria-controls="composer-bcc-row"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('hidden="" id="composer-cc-row"');
    expect(html).toContain('hidden="" id="composer-bcc-row"');
    expect(html).not.toMatch(/id="composer-to"[^>]*required/);
  });

  it("exposes pressed state only on formatting toggles", () => {
    const html = renderComposer(composer());
    const button = (label: string) =>
      html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`, "u"))
        ?.[0];

    expect(button("Bold")).toContain('aria-pressed="false"');
    expect(button("Bulleted list")).toContain('aria-pressed="false"');
    expect(button("Insert link")).toContain('aria-pressed="false"');
    expect(button("Clear formatting")).not.toContain("aria-pressed");
    expect(button("Undo")).not.toContain("aria-pressed");
    expect(button("Redo")).not.toContain("aria-pressed");
  });

  it("distinguishes a temporarily unverified provider limit", () => {
    const html = renderComposer(
      composer({
        attachmentCapabilityUnavailable: true,
        maxAttachmentBytes: 0,
      }),
    );

    expect(html).toContain("Attachment limit could not be verified");
    expect(html).toContain("Retry attachment check");
    expect(html).not.toContain("Attachments are unavailable for this provider");
  });

  it("shows keyboard focus on the attachment picker", () => {
    const html = renderComposer(composer());

    expect(html).toContain("focus-within:outline-2");
    expect(html).toContain("focus-within:outline-offset-2");
    expect(html).toContain("focus-within:outline-indigo-600");
    expect(html).toContain('id="composer-attachments"');
  });

  it("announces ready and failed attachment states", () => {
    const retry = vi.fn();
    const html = renderComposer(
      composer({
        attachments: [
          {
            error: null,
            id: "ready",
            meta: "2 KiB · application/pdf",
            name: "report.pdf",
            onRemove: vi.fn(),
            state: "ready",
          },
          {
            error: "Malware detected.",
            id: "failed",
            meta: "Upload failed",
            name: "unsafe.exe",
            onRemove: vi.fn(),
            state: "error",
          },
          {
            error: "Original attachment is too large.",
            id: "forward-failed",
            meta: "18 MiB · Upload failed",
            name: "archive.zip",
            onRemove: vi.fn(),
            onRetry: retry,
            state: "error",
          },
        ],
      }),
    );

    expect(html).toContain('role="status"');
    expect(html).toContain("report.pdf is ready to send.");
    expect(html).toContain('role="alert"');
    expect(html).toContain("unsafe.exe upload failed: Malware detected.");
    expect(html).toContain(
      "archive.zip could not be copied: Original attachment is too large.",
    );
    expect(html).toContain('aria-label="Retry copying archive.zip"');
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

  it("renders the plain editor and formatting-loss confirmation", () => {
    const base = composer();
    const html = renderComposer(
      composer({
        body: {
          ...base.body,
          isPlainModeWarningOpen: true,
          mode: "plain",
          text: "Readable fallback",
        },
      }),
    );

    expect(html).toContain('aria-label="Switch to rich text"');
    expect(html).toContain("Readable fallback");
    expect(html).toContain("Switching to plain text will remove");
    expect(html).toContain("Keep formatting");
    expect(html).not.toContain('aria-label="Formatting options"');
  });

  it("locks both formatting-loss choices while sending", () => {
    const base = composer();
    const html = renderComposer(
      composer({
        body: { ...base.body, isPlainModeWarningOpen: true },
        isSending: true,
      }),
    );
    const warningButton = (id: string) =>
      html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`, "u"))?.[0];

    expect(warningButton("composer-formatting-loss-confirm")).toContain(
      'disabled=""',
    );
    expect(warningButton("composer-formatting-loss-cancel")).toContain(
      'disabled=""',
    );
  });
});
