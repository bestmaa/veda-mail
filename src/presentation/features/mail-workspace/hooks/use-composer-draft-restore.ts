"use client";

import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import type { DraftDetail } from "@/domain/mail/draft";
import type { ComposerRecoveryJournal } from "@/presentation/features/mail-workspace/composer-recovery.types";
import {
  draftRequestAborted,
  isDraftConflict,
  providerDraftEditBlock,
  type ComposerDraftPhase,
  type ComposerDraftRetryKind,
  type ComposerTerminalRecoveryKind,
  INTERRUPTED_SEND_RECOVERY_MESSAGE,
} from "@/presentation/features/mail-workspace/composer-draft-state";
import type { ComposerDraftSaveAttempt } from "@/presentation/features/mail-workspace/composer-draft-save-attempt";
import type { useComposerDraftRequest } from "@/presentation/features/mail-workspace/hooks/use-composer-draft-request";
import type { MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import { mailApi } from "@/transport/client/api-client";

interface ComposerDraftRestoreOptions {
  readonly contentGenerationRef: MutableRefObject<number>;
  readonly handleSessionFailure: MailSessionFailureHandler;
  readonly onHydrate: (draft: DraftDetail) => void;
  readonly request: ReturnType<typeof useComposerDraftRequest>;
  readonly reset: () => void;
  readonly restorePending: (attempt: ComposerDraftSaveAttempt) => void;
  readonly setError: Dispatch<SetStateAction<string | null>>;
  readonly setGeneration: Dispatch<SetStateAction<number>>;
  readonly setHasUserEdits: Dispatch<SetStateAction<boolean>>;
  readonly setIsDirty: Dispatch<SetStateAction<boolean>>;
  readonly setIsLoading: Dispatch<SetStateAction<boolean>>;
  readonly setPhase: Dispatch<SetStateAction<ComposerDraftPhase>>;
  readonly setRequestedId: Dispatch<SetStateAction<DraftDetail["id"] | null>>;
  readonly setRequiresRecovery: Dispatch<SetStateAction<boolean>>;
  readonly setRetryKind: Dispatch<SetStateAction<ComposerDraftRetryKind>>;
  readonly setSaved: Dispatch<SetStateAction<DraftDetail | null>>;
  readonly setTerminalRecovery: Dispatch<SetStateAction<ComposerTerminalRecoveryKind | null>>;
}

export const useComposerDraftRestore = ({
  contentGenerationRef, handleSessionFailure, onHydrate, request, reset,
  restorePending, setError, setGeneration, setHasUserEdits, setIsDirty,
  setIsLoading, setPhase, setRequestedId, setRequiresRecovery, setRetryKind,
  setSaved,
  setTerminalRecovery,
}: ComposerDraftRestoreOptions) => useCallback(async (
  journal: ComposerRecoveryJournal,
): Promise<boolean> => {
  reset();
  contentGenerationRef.current = journal.localGeneration;
  setGeneration(journal.localGeneration);
  setHasUserEdits(true);
  setIsDirty(true);
  if (journal.terminalIntent) {
    setRequiresRecovery(true);
    setRetryKind("blocked");
    setTerminalRecovery(journal.terminalIntent.kind);
    setError(journal.terminalIntent.kind === "send"
      ? INTERRUPTED_SEND_RECOVERY_MESSAGE
      : "This interrupted discard must be explicitly completed.");
    setPhase("error");
    return true;
  }
  if (journal.pendingSave) {
    restorePending(journal.pendingSave);
    setRequiresRecovery(true);
    setRetryKind("reconcile");
    setError("An interrupted mailbox save must be recovered before autosave can continue.");
    setPhase("error");
    return true;
  }
  const acknowledged = journal.acknowledged;
  if (!acknowledged) {
    setPhase("unsaved");
    return true;
  }
  const operation = request.begin();
  setRequestedId(acknowledged.providerDraftId);
  setIsLoading(true);
  try {
    const draft = await mailApi.getDraft(
      acknowledged.providerDraftId, operation.accountKey,
      operation.controller.signal,
    );
    if (!request.isCurrent(operation)) return false;
    if (draft.composeId !== journal.composeId ||
      draft.revision !== acknowledged.revision) {
      setError("This saved draft changed elsewhere. Your recovered changes are still here; reloading the saved draft will replace them.");
      setRetryKind("blocked");
      setPhase("conflict");
      return false;
    }
    setSaved(draft);
    const dirty = journal.localGeneration > acknowledged.generation;
    setIsDirty(dirty);
    setRequiresRecovery(false);
    setRetryKind("none");
    if (!dirty) onHydrate(draft);
    const editBlock = providerDraftEditBlock(draft);
    if (editBlock) {
      setError(editBlock);
      setRetryKind("blocked");
      setPhase("error");
      return false;
    }
    setPhase(dirty ? "unsaved" : "saved");
    return true;
  } catch (error) {
    if (draftRequestAborted(error) || !request.isCurrent(operation)) return false;
    if (handleSessionFailure(error)) return false;
    setError("The saved draft could not be verified. Your recovered changes are still here.");
    setRetryKind("blocked");
    setPhase(isDraftConflict(error) ? "conflict" : "error");
    return false;
  } finally {
    if (request.finish(operation)) setIsLoading(false);
  }
}, [contentGenerationRef, handleSessionFailure, onHydrate, request, reset,
  restorePending, setError, setGeneration, setHasUserEdits, setIsDirty,
  setIsLoading, setPhase, setRequestedId, setRequiresRecovery, setRetryKind,
  setSaved, setTerminalRecovery]);
