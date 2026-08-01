import type { FormEventHandler, KeyboardEventHandler } from "react";

import type { LabelColor, MailLabel } from "@/domain/mail/label";

export interface LabelManagementViewModel {
  readonly color: LabelColor;
  readonly colors: readonly LabelColor[];
  readonly error: string | null;
  readonly isOpen: boolean;
  readonly isSaving: boolean;
  readonly isSupported: boolean;
  readonly labels: readonly MailLabel[];
  readonly mode: "create" | "edit";
  readonly name: string;
  readonly onClose: () => void;
  readonly onColorChange: (color: LabelColor) => void;
  readonly onDialogKeyDown: KeyboardEventHandler<HTMLDivElement>;
  readonly onNameChange: (name: string) => void;
  readonly onSubmit: FormEventHandler<HTMLFormElement>;
  readonly openCreate: () => void;
  readonly openEdit: (labelId: string) => void;
  readonly title: string;
}
