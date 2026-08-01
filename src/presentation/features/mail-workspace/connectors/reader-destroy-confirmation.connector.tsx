"use client";

import type { ComposerConfirmationViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";
import { ReaderDestroyConfirmationView } from "@/presentation/features/mail-workspace/ui/reader-destroy-confirmation.view";
import { useModalDialogFocus } from "@/presentation/shared/hooks/use-modal-dialog-focus";

export const ReaderDestroyConfirmationConnector = ({
  confirmation,
}: {
  readonly confirmation: ComposerConfirmationViewModel;
}) => {
  useModalDialogFocus(
    confirmation.isOpen,
    "#reader-destroy-confirmation-dialog",
    confirmation.onCancel,
    "#reader-destroy-confirmation-cancel",
  );
  return <ReaderDestroyConfirmationView confirmation={confirmation} />;
};
