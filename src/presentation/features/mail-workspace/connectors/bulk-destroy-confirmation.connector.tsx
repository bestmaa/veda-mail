"use client";

import type { BulkActionsViewModel } from "@/presentation/features/mail-workspace/bulk-actions.view-model";
import { BulkDestroyConfirmationView } from "@/presentation/features/mail-workspace/ui/bulk-destroy-confirmation.view";
import { useModalDialogFocus } from "@/presentation/shared/hooks/use-modal-dialog-focus";

export const BulkDestroyConfirmationConnector = ({
  bulk,
}: {
  readonly bulk: BulkActionsViewModel;
}) => {
  useModalDialogFocus(
    bulk.destroyConfirmation.isOpen,
    "#bulk-destroy-confirmation-dialog",
    bulk.destroyConfirmation.onCancel,
    "#bulk-destroy-confirmation-cancel",
  );
  return <BulkDestroyConfirmationView bulk={bulk} />;
};
