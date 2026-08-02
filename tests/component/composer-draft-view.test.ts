import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ComposerViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";
import { ComposerView } from "@/presentation/features/mail-workspace/ui/composer.view";
import { composerTemplateViewModel } from "../support/composer-template-view-model";

const model = (): ComposerViewModel => ({
  attachmentCapabilityUnavailable: false,
  attachments: [],
  attachmentInput: vi.fn(),
  bcc: "", bccInput: vi.fn(),
  body: {
    cancelPlainMode: vi.fn(), confirmPlainMode: vi.fn(), editorVersion: 0,
    html: "", isPlainModeWarningOpen: false, mode: "plain",
    onPlainDrop: vi.fn(), onPlainInput: vi.fn(), onPlainPaste: vi.fn(),
    onRichChange: vi.fn(), onRichInitialize: vi.fn(), onToggleMode: vi.fn(),
    onWarningKeyDown: vi.fn(), plainTransferStatus: "", signature: null,
    signatureAnnouncement: "", signatureDetached: false, text: "Body",
    templates: composerTemplateViewModel(),
  },
  cc: "", ccInput: vi.fn(),
  closeConfirmation: { isOpen: false, onCancel: vi.fn(), onConfirm: vi.fn() },
  discardConfirmation: { isOpen: false, onCancel: vi.fn(), onConfirm: vi.fn() },
  draft: {
    canAttach: true, canDiscard: true, canEdit: true, canSave: false, canSend: true,
    enabled: true, error: null, loadFailed: false, onReload: null,
    onRequestDiscard: vi.fn(), onRetry: vi.fn(), onSave: vi.fn(),
    phase: "saved", requiresRecovery: false, sendBlockedMessage: null,
    status: { announcement: "Saved", label: "Saved", tone: "muted" },
    terminalRecovery: null,
  },
  error: null, focusBody: false, isAttachmentCapabilityRefreshing: false,
  isBusy: false, isOpen: true, isSending: false, isUploading: false,
  maxAttachmentBytes: 1_000, onClose: vi.fn(),
  onRetryAttachmentCapability: vi.fn(), onSubmit: vi.fn(),
  onToggleBcc: vi.fn(), onToggleCc: vi.fn(), showBcc: false, showCc: false,
  recoveryPrompt: {
    description: "Interrupted draft available.", error: null,
    hadLocalAttachments: false, initialFocus: "primary", isLoading: false,
    isOpen: false, onDismiss: vi.fn(), onPrimary: vi.fn(),
    onSecondary: vi.fn(), primaryLabel: "Restore draft",
    secondaryLabel: "Discard recovery copy", title: "Restore interrupted draft?",
  },
  subject: "", subjectInput: vi.fn(), title: "Edit draft",
  to: "recipient@example.com", toInput: vi.fn(),
});

const render = (composer: ComposerViewModel) => renderToStaticMarkup(
  createElement(ComposerView, { composer, deliveryNotice: null }),
);

describe("composer provider draft controls", () => {
  it("announces status and disables an unchanged manual save", () => {
    const html = render(model());
    expect(html).toContain("Save draft");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain(">Saved</span>");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Save draft/);
  });

  it("keeps the editor usable while a background draft save is pending", () => {
    const base = model();
    const html = render({
      ...base,
      draft: { ...base.draft, canAttach: false, canSave: false, phase: "saving" },
    });
    for (const id of ["composer-to", "composer-message-body"]) {
      const field = html.match(new RegExp(`<[^>]+id="${id}"[^>]*>`))?.[0];
      expect(field).not.toContain('disabled=""');
    }
    expect(html.match(/<button[^>]*id="composer-close"[^>]*>/)?.[0]).toContain('disabled=""');
    expect(html.match(/<input[^>]*id="composer-attachments"[^>]*>/)?.[0]).toContain('disabled=""');
    expect(html.match(/<button[^>]*id="composer-discard"[^>]*>/)?.[0]).toContain('disabled=""');
  });

  it("renders distinct close and permanent-discard confirmations", () => {
    const closeBase = model();
    const close = { ...closeBase, closeConfirmation: {
      ...closeBase.closeConfirmation, isOpen: true,
    } };
    const discardBase = model();
    const discard = { ...discardBase, discardConfirmation: {
      ...discardBase.discardConfirmation, isOpen: true,
    } };
    const closeHtml = render(close);
    const discardHtml = render(discard);
    expect(closeHtml).toContain('role="alertdialog"');
    expect(closeHtml).toContain("Close without saving");
    expect(closeHtml).toContain("Keep editing");
    expect(closeHtml).toContain('inert=""');
    expect(discardHtml).toContain("Discard draft permanently");
    expect(discardHtml).toContain("Keep draft");
    expect(discardHtml).not.toContain("Close without saving");
  });

  it("blocks send, save, and retry for non-editable provider metadata", () => {
    const base = model();
    const composer = { ...base, draft: {
      ...base.draft, canEdit: false, canSave: false, canSend: false,
      error: "This provider draft contains incomplete or unsupported content and cannot be edited safely.", phase: "error" as const,
    } };
    const html = render(composer);
    expect(html).toContain("cannot be edited safely");
    expect(html).not.toContain("Retry save");
    for (const id of ["composer-to", "composer-message-body"]) {
      const field = html.match(new RegExp(`<[^>]+id="${id}"[^>]*>`))?.[0];
      expect(field).toContain('readOnly=""');
      expect(field).not.toContain('disabled=""');
    }
    expect(html.match(/<input[^>]*id="composer-attachments"[^>]*>/)?.[0])
      .toContain('disabled=""');
    expect(html.match(/<button[^>]*id="composer-close"[^>]*>/)?.[0]).not.toContain('disabled=""');
    expect(html.match(/<button[^>]*id="composer-discard"[^>]*>/)?.[0]).not.toContain('disabled=""');
  });

  it("keeps uncertain draft content copyable while only discard remains enabled", () => {
    const base = model();
    const html = render({
      ...base,
      body: { ...base.body, text: "Copy this recovered content" },
      draft: {
        ...base.draft,
        canEdit: false, canSave: false, canSend: false,
        error: "This draft has an uncertain send outcome. Check Sent before continuing.",
        phase: "error",
      },
      subject: "Uncertain delivery",
    });

    expect(html).toContain("uncertain send outcome");
    expect(html).toContain("Check Sent");
    expect(html).toContain("Copy this recovered content");
    expect(html).toContain('value="Uncertain delivery"');
    expect(html).toContain('readOnly=""');
    expect(html.match(/<button[^>]*id="composer-discard"[^>]*>/)?.[0]).not.toContain('disabled=""');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Send/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Save draft/);
  });

  it("shows local status and interrupted-send recovery without provider drafts", () => {
    const base = model();
    const html = render({ ...base, draft: {
      ...base.draft, canEdit: false, canSave: false, enabled: false, phase: "error",
      requiresRecovery: true, status: {
        announcement: "Saved locally", label: "Saved locally", tone: "muted",
      }, terminalRecovery: "send",
    } });
    expect(html).not.toContain("Save draft");
    expect(html).toContain("Saved locally");
    expect(html).toContain("I checked Sent");
    expect(html).toContain('readOnly=""');
  });

  it("disables confirmation actions while discard is in flight", () => {
    const base = model();
    const composer = {
      ...base,
      discardConfirmation: { ...base.discardConfirmation, isOpen: true },
      isBusy: true,
    };
    const html = render(composer);
    expect(html.match(/<button[^>]*id="composer-discard-confirm"[^>]*>/)?.[0]).toContain('disabled=""');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>\s*Keep draft<\/button>/);
  });

  it("offers exact recovery instead of reloading a stale immutable ID", () => {
    const base = model();
    const html = render({ ...base, draft: {
      ...base.draft, canDiscard: false, canSave: false, canSend: false,
      onReload: vi.fn(), phase: "conflict", requiresRecovery: true,
    } });
    expect(html).toContain("Recover saved draft");
    expect(html).not.toContain("Reload saved draft");
    expect(html.match(/<button[^>]*id="composer-discard"[^>]*>/)?.[0]).toContain('disabled=""');
  });
});
