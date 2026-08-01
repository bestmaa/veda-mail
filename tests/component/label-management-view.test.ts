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
  error: null,
  isOpen: true,
  isSaving: false,
  isSupported: true,
  labels: [{ color: "#4f46e5", id: id.label("veda-label-aaaqeayeaudaocajbifqydiob4"), name: "Clients" }],
  mode: "edit",
  name: "Clients",
  onClose: vi.fn(),
  onColorChange: vi.fn(),
  onDialogKeyDown: vi.fn(),
  onNameChange: vi.fn(),
  onSubmit: vi.fn(),
  openCreate: vi.fn(),
  openEdit: vi.fn(),
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
  });

  it("locks controls and announces provider errors while saving", () => {
    const html = renderToStaticMarkup(createElement(LabelManagementView, {
      management: model({ error: "Label conflict.", isSaving: true }),
    }));

    expect(html).toContain('role="alert"');
    expect(html).toContain("Label conflict.");
    expect(html.match(/disabled=""/gu)?.length).toBeGreaterThanOrEqual(4);
  });
});
