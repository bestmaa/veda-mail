import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { MailboxManagementViewModel } from "@/presentation/features/mail-workspace/mailbox-management.view-model";
import { MailboxManagementView } from "@/presentation/features/mail-workspace/ui/mailbox-management.view";

const model = (
  overrides: Partial<MailboxManagementViewModel> = {},
): MailboxManagementViewModel => ({
  canDelete: true,
  color: "#64748b",
  colors: ["#64748b", "#a855f7"],
  deleteConfirmationOpen: false,
  error: null,
  isOpen: true,
  isSaving: false,
  mode: "edit",
  name: "Projects",
  onCancelDelete: vi.fn(),
  onClose: vi.fn(),
  onColorChange: vi.fn(),
  onConfirmDelete: vi.fn(),
  onDialogKeyDown: vi.fn(),
  onNameChange: vi.fn(),
  onParentChange: vi.fn(),
  onRequestDelete: vi.fn(),
  onSubmit: vi.fn(),
  openCreate: vi.fn(),
  openEdit: vi.fn(),
  parentId: "",
  parentOptions: [{ id: "parent", label: "Parent" }],
  title: "Edit mailbox",
  ...overrides,
});

const render = (management: MailboxManagementViewModel): string =>
  renderToStaticMarkup(createElement(MailboxManagementView, { management }));

describe("mailbox management view", () => {
  it("renders labelled hierarchy, palette, and mutation controls", () => {
    const html = render(model());
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('id="mailbox-management-title"');
    expect(html).toContain("Parent mailbox");
    expect(html).toContain("No parent (top level)");
    expect(html).toContain("Projects");
    expect(html).toContain("Delete");
    expect(html).toContain("Save");
  });

  it("uses a second explicit step for destructive deletion", () => {
    const html = render(model({ deleteConfirmationOpen: true }));
    expect(html).toContain("This cannot be undone");
    expect(html).toContain("Delete mailbox");
    expect(html).toContain("Cancel");
  });
});
