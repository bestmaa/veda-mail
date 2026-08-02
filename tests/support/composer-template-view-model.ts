import { vi } from "vitest";

import type { ComposerTemplateViewModel } from "@/presentation/features/mail-workspace/composer-template.view-model";

export const composerTemplateViewModel = (
  overrides: Partial<ComposerTemplateViewModel> = {},
): ComposerTemplateViewModel => ({
  announcement: "",
  application: null,
  applyPlainTemplate: vi.fn(() => 0),
  canManage: true,
  closeDialog: vi.fn(),
  confirmDelete: vi.fn(),
  confirmReplace: vi.fn(),
  confirmSave: vi.fn(),
  dialog: null,
  error: null,
  isApplying: false,
  isLoading: false,
  isSaving: false,
  name: "",
  nameInput: vi.fn(),
  onApplied: vi.fn(),
  onInsert: vi.fn(),
  onRequestDelete: vi.fn(),
  onRequestReplace: vi.fn(),
  onSaveNew: vi.fn(),
  onSelect: vi.fn(),
  onUpdate: vi.fn(),
  options: [],
  reset: vi.fn(),
  retry: vi.fn(),
  selectedId: "",
  ...overrides,
});
