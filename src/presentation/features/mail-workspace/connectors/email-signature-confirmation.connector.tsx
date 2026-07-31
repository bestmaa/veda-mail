"use client";

import type { EmailSignatureConfirmationViewModel } from "@/presentation/features/mail-workspace/email-signature-settings.view-model";
import { EmailSignatureConfirmationView } from "@/presentation/features/mail-workspace/ui/email-signature-confirmation.view";
import { useModalDialogFocus } from "@/presentation/shared/hooks/use-modal-dialog-focus";

export const EmailSignatureConfirmationConnector = ({
  confirmation,
  confirmLabel,
  idPrefix,
}: {
  readonly confirmation: EmailSignatureConfirmationViewModel;
  readonly confirmLabel: string;
  readonly idPrefix: string;
}) => {
  useModalDialogFocus(
    confirmation.isOpen,
    `#${idPrefix}`,
    confirmation.onCancel,
    `#${idPrefix}-confirm`,
  );
  return (
    <EmailSignatureConfirmationView
      confirmation={confirmation}
      confirmLabel={confirmLabel}
      idPrefix={idPrefix}
    />
  );
};
