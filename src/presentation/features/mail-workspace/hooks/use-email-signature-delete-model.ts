"use client";

import { useCallback, useState } from "react";

import type { EmailSignature } from "@/domain/member/email-signature";
import type { EmailSignatureConfirmationViewModel } from "@/presentation/features/mail-workspace/email-signature-settings.view-model";
import type { EmailSignaturesModel } from "@/presentation/features/mail-workspace/hooks/use-email-signatures-model";

const restoreDeleteFocus = (): void => {
  window.requestAnimationFrame(() => {
    document.getElementById("email-signature-delete")?.focus();
  });
};

export const useEmailSignatureDeleteModel = (
  signatures: EmailSignaturesModel,
  select: (signature: EmailSignature | null) => void,
  onStatus: (message: string) => void,
) => {
  const [target, setTarget] = useState<EmailSignature | null>(null);
  const cancel = useCallback(() => {
    setTarget(null);
    restoreDeleteFocus();
  }, []);
  const confirm = useCallback(async () => {
    if (!target) return;
    const result = await signatures.mutate({
      operation: "delete",
      signatureId: target.id,
    });
    if (!result) return;
    setTarget(null);
    const selected = result.signatures[0] ?? null;
    select(selected);
    onStatus(`Signature “${target.name}” deleted.`);
    window.requestAnimationFrame(() => {
      document
        .getElementById(
          selected ? `email-signature-item-${selected.id}` : "email-signature-create",
        )
        ?.focus();
    });
  }, [onStatus, select, signatures, target]);
  const confirmation: EmailSignatureConfirmationViewModel = {
    description: target
      ? `Delete “${target.name}”? Any default using it will be reset to no signature.`
      : "",
    isOpen: Boolean(target),
    onCancel: cancel,
    onConfirm: () => void confirm(),
    title: "Delete signature?",
  };
  return {
    cancel,
    confirmation,
    request: setTarget,
    reset: () => setTarget(null),
  };
};
