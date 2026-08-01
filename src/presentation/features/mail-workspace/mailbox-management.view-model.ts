import type {
  FormEventHandler,
  KeyboardEventHandler,
} from "react";

import type { MailboxColor } from "@/domain/mail/mailbox";

export interface MailboxParentOptionViewModel {
  readonly id: string;
  readonly label: string;
}

export interface MailboxManagementViewModel {
  readonly canDelete: boolean;
  readonly color: MailboxColor;
  readonly colors: readonly MailboxColor[];
  readonly deleteConfirmationOpen: boolean;
  readonly error: string | null;
  readonly isOpen: boolean;
  readonly isSaving: boolean;
  readonly mode: "create" | "edit";
  readonly name: string;
  readonly onCancelDelete: () => void;
  readonly onClose: () => void;
  readonly onColorChange: (color: MailboxColor) => void;
  readonly onConfirmDelete: () => void;
  readonly onDialogKeyDown: KeyboardEventHandler<HTMLDivElement>;
  readonly onNameChange: (name: string) => void;
  readonly onParentChange: (parentId: string) => void;
  readonly onRequestDelete: () => void;
  readonly onSubmit: FormEventHandler<HTMLFormElement>;
  readonly openCreate: (parentId?: string) => void;
  readonly openEdit: (mailboxId: string) => void;
  readonly parentId: string;
  readonly parentOptions: readonly MailboxParentOptionViewModel[];
  readonly title: string;
}
