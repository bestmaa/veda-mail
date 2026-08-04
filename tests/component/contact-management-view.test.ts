import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ContactBook } from "@/domain/member/contact";
import { id } from "@/domain/shared/brand";
import type { ContactManagementViewModel } from "@/presentation/features/mail-workspace/contact-management.view-model";
import { ContactManagementView } from "@/presentation/features/mail-workspace/ui/contact-management.view";

const contactId = id.contact("00000000-0000-4000-8000-000000000001");
const book: ContactBook = {
  contacts: [{
    createdAt: "2026-08-04T00:00:00.000Z",
    emails: [{ email: "ada@example.com", label: "work" }],
    id: contactId,
    name: "Ada Lovelace",
    updatedAt: "2026-08-04T00:00:00.000Z",
    version: 1,
  }],
  createdAt: "2026-08-04T00:00:00.000Z",
  groups: [{
    contactIds: [contactId],
    createdAt: "2026-08-04T00:00:00.000Z",
    id: id.contactGroup("00000000-0000-4000-8000-000000000002"),
    name: "Engineering",
    updatedAt: "2026-08-04T00:00:00.000Z",
    version: 1,
  }],
  recents: [{
    email: "grace@example.com",
    lastUsedAt: "2026-08-04T00:00:00.000Z",
    name: "Grace Hopper",
    useCount: 3,
  }],
  revision: "11111111-1111-4111-8111-111111111111",
  updatedAt: "2026-08-04T00:00:00.000Z",
  version: 1,
};

const model = (
  overrides: Partial<ContactManagementViewModel> = {},
): ContactManagementViewModel => ({
  book,
  close: vi.fn(),
  contactEditor: {
    addEmail: vi.fn(), emails: [{ email: "", label: null }], isOpen: false,
    name: "", onCancel: vi.fn(), onNameInput: vi.fn(), onSubmit: vi.fn(),
    removeEmail: vi.fn(), title: "New contact", updateEmail: vi.fn(),
  },
  deleteConfirmation: {
    description: "", isOpen: false, onCancel: vi.fn(), onConfirm: vi.fn(),
  },
  error: null,
  groupEditor: {
    contactIds: [], isOpen: false, name: "", onCancel: vi.fn(),
    onNameInput: vi.fn(), onSubmit: vi.fn(), title: "New group",
    toggleContact: vi.fn(),
  },
  hasConflict: false,
  isLoading: false,
  isOpen: true,
  isSaving: false,
  onClearRecents: vi.fn(),
  onCreateContact: vi.fn(),
  onCreateGroup: vi.fn(),
  onDeleteContact: vi.fn(),
  onDeleteGroup: vi.fn(),
  onEditContact: vi.fn(),
  onEditGroup: vi.fn(),
  open: vi.fn(),
  retry: vi.fn(),
  section: "contacts",
  selectSection: vi.fn(),
  transfer: {
    error: null, isExporting: false, isImporting: false,
    onExport: vi.fn(), onImportFile: vi.fn(),
  },
  ...overrides,
});

const render = (management: ContactManagementViewModel): string =>
  renderToStaticMarkup(createElement(ContactManagementView, { management }));

describe("contact management view", () => {
  it("renders accessible address-book and vCard controls", () => {
    const html = render(model());
    expect(html).toContain('aria-label="Contacts"');
    expect(html).toContain('role="tablist"');
    expect(html).toContain("Import vCard");
    expect(html).toContain("Export");
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("ada@example.com");
  });

  it("supports a bounded multiple-email contact editor", () => {
    const current = model();
    const html = render(model({
      contactEditor: {
        ...current.contactEditor,
        emails: [
          { email: "ada@example.com", label: "work" },
          { email: "ada@home.example", label: "home" },
        ],
        isOpen: true,
        name: "Ada Lovelace",
        title: "Edit contact",
      },
    }));
    expect(html).toContain('aria-label="Edit contact"');
    expect(html).toContain('id="contact-email-1"');
    expect(html).toContain("Add email");
    expect(html).toContain('aria-hidden="true" inert=""');
  });

  it("shows groups, recents, and destructive confirmation explicitly", () => {
    expect(render(model({ section: "groups" }))).toContain("1 member");
    expect(render(model({ section: "recents" }))).toContain("used 3 times");
    const html = render(model({
      deleteConfirmation: {
        description: "Delete Ada Lovelace?",
        isOpen: true,
        onCancel: vi.fn(),
        onConfirm: vi.fn(),
      },
    }));
    expect(html).toContain("Delete Ada Lovelace?");
    expect(html).toContain('aria-label="Confirm contact deletion"');
  });
});
