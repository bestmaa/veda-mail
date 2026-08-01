"use client";

import type { ComposerViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";
import { ComposerRecoveryPromptView } from "@/presentation/features/mail-workspace/ui/composer-recovery-prompt.view";
import { useModalDialogFocus } from "@/presentation/shared/hooks/use-modal-dialog-focus";

const shouldRestorePromptFocus = (): boolean => !document.querySelector(
  '[role="dialog"][aria-label="Compose message"]',
);

export const ComposerRecoveryPromptConnector = ({
  prompt,
}: {
  readonly prompt: ComposerViewModel["recoveryPrompt"];
}) => {
  const initialFocus = prompt.initialFocus === "secondary"
    ? "#composer-recovery-secondary"
    : "#composer-recovery-primary";
  useModalDialogFocus(
    prompt.isOpen,
    "#composer-recovery-dialog",
    () => { if (!prompt.isLoading) prompt.onDismiss(); },
    initialFocus,
    shouldRestorePromptFocus,
  );
  return <ComposerRecoveryPromptView prompt={prompt} />;
};
