"use client";

import type { ScheduledSendManagerViewModel } from "@/presentation/features/mail-workspace/scheduled-send-manager.view-model";
import { ScheduledSendManagerView } from "@/presentation/features/mail-workspace/ui/scheduled-send-manager.view";
import { useModalDialogFocus } from "@/presentation/shared/hooks/use-modal-dialog-focus";

export const ScheduledSendManagerConnector = ({
  manager,
}: {
  readonly manager: ScheduledSendManagerViewModel;
}) => {
  useModalDialogFocus(
    manager.isOpen,
    "#scheduled-send-manager-dialog",
    manager.onClose,
    '[aria-label="Refresh scheduled messages"]',
  );
  return <ScheduledSendManagerView manager={manager} />;
};
