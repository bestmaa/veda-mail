"use client";

import type { MemberSessionViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";
import { MemberSignOutConfirmationView } from "@/presentation/features/mail-workspace/ui/member-sign-out-confirmation.view";
import { useModalDialogFocus } from "@/presentation/shared/hooks/use-modal-dialog-focus";

export const MemberSignOutConfirmationConnector = ({
  session,
}: {
  readonly session: MemberSessionViewModel;
}) => {
  useModalDialogFocus(
    session.confirmation.isOpen,
    "#member-sign-out-confirmation-dialog",
    session.confirmation.onCancel,
    "#member-sign-out-confirmation-cancel",
  );
  return <MemberSignOutConfirmationView session={session} />;
};
