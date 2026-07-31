import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { id } from "@/domain/shared/brand";
import type { EmailSignatureSettingsViewModel } from "@/presentation/features/mail-workspace/email-signature-settings.view-model";
import { EmailSignatureSettingsView } from "@/presentation/features/mail-workspace/ui/email-signature-settings.view";

const confirmation = {
  description: "",
  isOpen: false,
  onCancel: vi.fn(),
  onConfirm: vi.fn(),
  title: "",
};

const settings = (
  overrides: Partial<EmailSignatureSettingsViewModel> = {},
): EmailSignatureSettingsViewModel => ({
  accountEmail: "member@example.com",
  canCreate: true,
  create: vi.fn(),
  defaults: {
    canDiscard: false,
    canSave: false,
    newMessageId: "",
    newMessageInput: vi.fn(),
    onDiscard: vi.fn(),
    onSubmit: vi.fn(),
    replyForwardId: "",
    replyForwardInput: vi.fn(),
  },
  deleteConfirmation: confirmation,
  discardAll: vi.fn(),
  editor: {
    body: "Ada Lovelace",
    bodyInput: vi.fn(),
    canDelete: true,
    canDiscard: false,
    canSave: false,
    editorVersion: 1,
    htmlBody: "",
    isNew: false,
    mode: "plain",
    name: "Work",
    nameInput: vi.fn(),
    onDelete: vi.fn(),
    onDiscard: vi.fn(),
    onRichChange: vi.fn(),
    onRichInitialize: vi.fn(),
    onSubmit: vi.fn(),
    selectPlainMode: vi.fn(),
    selectRichMode: vi.fn(),
  },
  error: null,
  hasUnsavedChanges: false,
  isLoading: false,
  isReady: true,
  isSaving: false,
  items: [
    {
      id: id.signature("11111111-1111-4111-8111-111111111111"),
      isSelected: true,
      name: "Work",
      onSelect: vi.fn(),
    },
  ],
  maximumSignatures: 20,
  modeConfirmation: confirmation,
  retry: vi.fn(),
  status: null,
  ...overrides,
});

const render = (model: EmailSignatureSettingsViewModel): string =>
  renderToStaticMarkup(
    createElement(EmailSignatureSettingsView, { settings: model }),
  );

describe("email signature settings view", () => {
  it("renders named CRUD controls and explicit disabled defaults", () => {
    const html = render(settings());

    expect(html).toContain('id="email-signature-settings-title"');
    expect(html).toContain("Signatures for member@example.com");
    expect(html).toContain('aria-label="Create signature"');
    expect(html).toContain('aria-label="Saved signatures"');
    expect(html).toContain('aria-current="true"');
    expect(html).toContain(
      "Creating a signature does not enable it automatically",
    );
    expect(
      html.match(/<option value="" selected="">No signature/g),
    ).toHaveLength(2);
    expect(html).toContain("Discard changes");
    expect(html).toContain("Save signature");
  });

  it("labels required plain and rich signature content", () => {
    const plain = render(settings());
    expect(plain).toMatch(/<textarea[^>]*required=""/u);
    const base = settings();
    const rich = render(
      settings({
        editor: base.editor
          ? {
              ...base.editor,
              htmlBody: "<p><strong>Ada</strong></p>",
              mode: "rich",
            }
          : null,
      }),
    );

    expect(rich).toContain('aria-label="Signature content"');
    expect(rich).toContain('aria-required="true"');
    expect(rich).toContain('aria-label="Formatting options"');
  });

  it("renders a labelled, focusable destructive confirmation", () => {
    const html = render(
      settings({
        deleteConfirmation: {
          ...confirmation,
          description: "Delete Work?",
          isOpen: true,
          title: "Delete signature?",
        },
      }),
    );

    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('id="email-signature-delete-confirmation"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain("Delete Work?");
  });

  it("keeps mutation controls disabled until the signature book loads", () => {
    const html = render(
      settings({
        canCreate: false,
        error: "Unable to load signatures.",
        isReady: false,
        items: [],
      }),
    );

    expect(html).toMatch(/aria-label="Create signature"[^>]*disabled/u);
    expect(html.match(/<select[^>]*disabled/gu)).toHaveLength(2);
    expect(html).toContain("Retry");
  });
});
