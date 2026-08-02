"use client";

import type { KeyboardShortcutsViewModel } from "@/presentation/features/mail-workspace/keyboard-shortcuts.view-model";
import { KeyboardShortcutsDialogView } from "@/presentation/features/mail-workspace/ui/keyboard-shortcuts-dialog.view";
import { useModalDialogFocus } from "@/presentation/shared/hooks/use-modal-dialog-focus";

export const KeyboardShortcutsDialogConnector = ({
  shortcuts,
}: {
  readonly shortcuts: KeyboardShortcutsViewModel;
}) => {
  useModalDialogFocus(
    shortcuts.dialog.isOpen,
    "#keyboard-shortcuts-dialog",
    shortcuts.dialog.onClose,
    'button[aria-label="Close keyboard shortcut guide"]',
  );
  return <KeyboardShortcutsDialogView dialog={shortcuts.dialog} />;
};
