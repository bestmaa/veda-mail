"use client";

import type { MailWorkspaceViewProps } from "@/presentation/features/mail-workspace/mail-workspace.view-model";
import { MessageMoveDialogView } from "@/presentation/features/mail-workspace/ui/message-move-dialog.view";
import { useModalDialogFocus } from "@/presentation/shared/hooks/use-modal-dialog-focus";

export const MessageMoveDialogConnector = ({
  move,
}: {
  readonly move: MailWorkspaceViewProps["messageMove"];
}) => {
  useModalDialogFocus(
    move.dialog.isOpen,
    "#message-move-dialog",
    move.dialog.onCancel,
    move.dialog.targets.length ? "#message-move-target-0" : "#message-move-cancel",
  );
  return <MessageMoveDialogView dialog={move.dialog} />;
};
