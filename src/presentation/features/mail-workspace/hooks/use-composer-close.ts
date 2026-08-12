"use client";

import {
  useCallback, useRef, useState, type Dispatch, type SetStateAction,
} from "react";

import type { useComposerAttachments } from "@/presentation/features/mail-workspace/hooks/use-composer-attachments";
import type { useComposerDraft } from "@/presentation/features/mail-workspace/hooks/use-composer-draft";
import type { useComposerReturnFocus } from "@/presentation/features/mail-workspace/hooks/use-composer-focus";

const focusById = (elementId: string, attempts = 60) => {
  if (typeof window === "undefined") return;
  window.requestAnimationFrame(() => {
    const element = document.getElementById(elementId);
    if (element && !(element instanceof HTMLButtonElement && element.disabled)) {
      element.focus();
    } else if (attempts > 1) {
      focusById(elementId, attempts - 1);
    }
  });
};

export const useComposerClose = ({
  accountKeyRef, attachments, confirmClose, confirmDiscard, draft, isSending,
  openAccountKey, resetEditor, returnFocus, setConfirmClose,
  setConfirmDiscard, setError, setIsOpen,
}: {
  readonly accountKeyRef: { readonly current: string };
  readonly attachments: ReturnType<typeof useComposerAttachments>;
  readonly confirmClose: boolean;
  readonly confirmDiscard: boolean;
  readonly draft: ReturnType<typeof useComposerDraft>;
  readonly isSending: boolean;
  readonly openAccountKey: string;
  readonly resetEditor: () => void;
  readonly returnFocus: ReturnType<typeof useComposerReturnFocus>;
  readonly setConfirmClose: Dispatch<SetStateAction<boolean>>;
  readonly setConfirmDiscard: Dispatch<SetStateAction<boolean>>;
  readonly setError: Dispatch<SetStateAction<string | null>>;
  readonly setIsOpen: Dispatch<SetStateAction<boolean>>;
}) => {
  const [isClosing, setIsClosing] = useState(false);
  const closing = useRef(false);
  const finish = useCallback(async () => {
    if (closing.current) return;
    closing.current = true;
    setIsClosing(true);
    setError(null);
    try {
      await draft.clearRecovery();
      if (openAccountKey !== accountKeyRef.current) return;
      setIsOpen(false);
      draft.reset();
      resetEditor();
      attachments.discard(true);
      returnFocus.restore();
    } catch {
      setError("Couldn’t securely remove the local recovery copy. Keep this composer open and retry.");
    } finally {
      closing.current = false;
      setIsClosing(false);
    }
  }, [accountKeyRef, attachments, draft, openAccountKey, resetEditor,
    returnFocus, setError, setIsOpen]);
  const request = useCallback(() => {
    if (isClosing || isSending || draft.isDiscarding || draft.isLoading ||
      draft.phase === "saving") return;
    if (confirmDiscard) {
      setConfirmDiscard(false);
      focusById("composer-discard");
    } else if (confirmClose) {
      setConfirmClose(false);
      focusById("composer-close");
    } else if (draft.hasUnsavedChanges) {
      setConfirmClose(true);
      focusById("composer-close-without-saving");
    } else void finish();
  }, [confirmClose, confirmDiscard, draft, finish, isClosing, isSending,
    setConfirmClose, setConfirmDiscard]);
  const discard = useCallback(async () => {
    if (await draft.discard()) await finish();
  }, [draft, finish]);
  const requestDiscard = useCallback(() => {
    if (!draft.canDiscard || isClosing || isSending || draft.isDiscarding ||
      draft.isLoading || draft.phase === "saving") return;
    if (!draft.requiresDiscardConfirmation) return void discard();
    setConfirmDiscard(true);
    focusById("composer-discard-confirm");
  }, [discard, draft, isClosing, isSending, setConfirmDiscard]);
  return {
    cancelClose: useCallback(() => {
      setConfirmClose(false); focusById("composer-close");
    }, [setConfirmClose]),
    cancelDiscard: useCallback(() => {
      setConfirmDiscard(false); focusById("composer-discard");
    }, [setConfirmDiscard]),
    confirmClose: finish,
    confirmDiscard: discard,
    isClosing,
    requestClose: request,
    requestDiscard,
  };
};
