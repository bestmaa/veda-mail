import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { id } from "@/domain/shared/brand";
import type { LabelManagementViewModel } from "@/presentation/features/mail-workspace/label-management.view-model";
import { LabelManagementView } from "@/presentation/features/mail-workspace/ui/label-management.view";

const model = (
  overrides: Partial<LabelManagementViewModel> = {},
): LabelManagementViewModel => ({
  color: "#4f46e5",
  colors: ["#64748b", "#4f46e5"],
  deletingLabelIds: new Set(),
  error: null,
  isConfirmingDelete: false,
  isOpen: true,
  isSaving: false,
  isSupported: true,
  isTargetDeleting: false,
  labels: [{ color: "#4f46e5", id: id.label("veda-label-aaaqeayeaudaocajbifqydiob4"), name: "Clients" }],
  mode: "edit",
  name: "Clients",
  onClose: vi.fn(),
  onColorChange: vi.fn(),
  onDialogKeyDown: vi.fn(),
  onDelete: vi.fn(),
  onNameChange: vi.fn(),
  onSubmit: vi.fn(),
  openCreate: vi.fn(),
  openEdit: vi.fn(),
  requestDelete: vi.fn(),
  title: "Edit label",
  ...overrides,
});

describe("label management view", () => {
  it("renders an accessible name and fixed-palette editor", () => {
    const html = renderToStaticMarkup(
      createElement(LabelManagementView, { management: model() }),
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('id="label-management-title"');
    expect(html).toContain('aria-label="Use #4f46e5"');
    expect(html).toContain('maxLength="100"');
    expect(html).toContain("Clients");
    expect(html).toContain("Save");
    expect(html).toContain("Delete label");
  });

  it("locks controls and announces provider errors while saving", () => {
    const html = renderToStaticMarkup(createElement(LabelManagementView, {
      management: model({ error: "Label conflict.", isSaving: true }),
    }));

    expect(html).toContain('role="alert"');
    expect(html).toContain("Label conflict.");
    expect(html.match(/disabled=""/gu)?.length).toBeGreaterThanOrEqual(4);
  });

  it("requires explicit confirmation and explains resumable cleanup", () => {
    const confirmation = renderToStaticMarkup(createElement(LabelManagementView, {
      management: model({ isConfirmingDelete: true }),
    }));
    expect(confirmation).toContain("Confirm delete");
    expect(confirmation).toContain("resumable verified cleanup");

    const progress = renderToStaticMarkup(createElement(LabelManagementView, {
      management: model({ isTargetDeleting: true }),
    }));
    expect(progress).toContain("Deletion is in progress");
    expect(progress).toContain("Continue cleanup");
    expect(progress).toContain("Close");
  });
});
