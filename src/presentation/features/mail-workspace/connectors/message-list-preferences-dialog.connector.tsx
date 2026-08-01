"use client";

import type { MessageListPreferencesViewModel } from "@/presentation/features/mail-workspace/message-list-preferences.view-model";
import { useModalDialogFocus } from "@/presentation/shared/hooks/use-modal-dialog-focus";
import { MessageListPreferencesDialogView } from "@/presentation/features/mail-workspace/ui/message-list-preferences-dialog.view";

export const MessageListPreferencesDialogConnector = ({
  preferences,
}: {
  readonly preferences: MessageListPreferencesViewModel;
}) => {
  useModalDialogFocus(
    preferences.dialog.isOpen,
    "#message-list-preferences-dialog",
    preferences.dialog.onClose,
    "[name='message-list-density']",
  );
  return <MessageListPreferencesDialogView dialog={preferences.dialog} />;
};
