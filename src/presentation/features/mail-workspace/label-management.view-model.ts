import type { FormEventHandler, KeyboardEventHandler } from "react";

import type { LabelColor, MailLabel } from "@/domain/mail/label";

export interface LabelManagementViewModel {
  readonly color: LabelColor;
  readonly colors: readonly LabelColor[];
  readonly error: string | null;
  readonly isOpen: boolean;
  readonly isConfirmingDelete: boolean;
  readonly isSaving: boolean;
  readonly isSupported: boolean;
  readonly isTargetDeleting: boolean;
  readonly labels: readonly MailLabel[];
  readonly deletingLabelIds: ReadonlySet<string>;
  readonly mode: "create" | "edit";
  readonly name: string;
  readonly onClose: () => void;
  readonly onColorChange: (color: LabelColor) => void;
  readonly onDialogKeyDown: KeyboardEventHandler<HTMLDivElement>;
  readonly onDelete: () => void;
  readonly onNameChange: (name: string) => void;
  readonly onSubmit: FormEventHandler<HTMLFormElement>;
  readonly requestDelete: () => void;
  readonly openCreate: () => void;
  readonly openEdit: (labelId: string) => void;
  readonly title: string;
}
