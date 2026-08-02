"use client";

import { useCallback, useState, type FormEventHandler } from "react";

import { useModalDialogFocus } from "@/presentation/shared/hooks/use-modal-dialog-focus";

export const useComposerSendConfirmation = (
  enabled: boolean,
  submit: () => Promise<void>,
) => {
  const [isOpen, setIsOpen] = useState(false);
  const cancel = useCallback(() => setIsOpen(false), []);
  useModalDialogFocus(
    isOpen,
    "#composer-send-confirmation",
    cancel,
    "[data-primary-focus='true']",
  );
  const onSubmit: FormEventHandler<HTMLFormElement> = useCallback((event) => {
    event.preventDefault();
    if (enabled) setIsOpen(true);
    else void submit();
  }, [enabled, submit]);
  const confirm = useCallback(() => {
    setIsOpen(false);
    void submit();
  }, [submit]);
  return { isOpen, onCancel: cancel, onConfirm: confirm, onSubmit };
};
