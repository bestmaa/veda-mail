import type { ChangeEventHandler } from "react";

import type { ComposerTemplateApplication } from "@/presentation/features/mail-workspace/composer-template-editor";

export interface ComposerTemplateViewModel {
  readonly announcement: string;
  readonly applyPlainTemplate: (
    application: ComposerTemplateApplication,
    selectionStart: number,
    selectionEnd: number,
  ) => number;
  readonly application: ComposerTemplateApplication | null;
  readonly canManage: boolean;
  readonly closeDialog: () => void;
  readonly confirmDelete: () => void;
  readonly confirmReplace: () => void;
  readonly confirmSave: () => void;
  readonly dialog: "delete" | "replace" | "save" | null;
  readonly error: string | null;
  readonly isApplying: boolean;
  readonly isLoading: boolean;
  readonly isSaving: boolean;
  readonly name: string;
  readonly nameInput: ChangeEventHandler<HTMLInputElement>;
  readonly onApplied: (nonce: number) => void;
  readonly onInsert: () => void;
  readonly onRequestDelete: () => void;
  readonly onRequestReplace: () => void;
  readonly onSaveNew: () => void;
  readonly onSelect: ChangeEventHandler<HTMLSelectElement>;
  readonly onUpdate: () => void;
  readonly options: readonly {
    readonly id: string;
    readonly name: string;
  }[];
  readonly retry: () => void;
  readonly reset: () => void;
  readonly selectedId: string;
}
