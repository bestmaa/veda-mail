"use client";

import type { MailboxLifecycleViewModel } from "@/presentation/features/mail-workspace/mailbox-lifecycle.view-model";
import { useModalDialogFocus } from "@/presentation/shared/hooks/use-modal-dialog-focus";
import { MailboxEmptyConfirmationView } from "@/presentation/features/mail-workspace/ui/mailbox-empty-confirmation.view";

export const MailboxEmptyConfirmationConnector = ({
  lifecycle,
}: {
  readonly lifecycle: MailboxLifecycleViewModel;
}) => {
  useModalDialogFocus(
    lifecycle.confirmation.isOpen,
    "#mailbox-empty-confirmation-dialog",
    lifecycle.confirmation.onCancel,
    "#mailbox-empty-confirmation-cancel",
  );
  return <MailboxEmptyConfirmationView lifecycle={lifecycle} />;
};
