"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DraftContent, DraftDetail } from "@/domain/mail/draft";
import type { DraftId, ProviderDraftId } from "@/domain/shared/brand";
import type { ComposerRecoverySnapshot } from "@/presentation/features/mail-workspace/composer-recovery.types";
import {
  composerDraftAvailability,
  draftFailureMessage,
  draftRequestAborted,
  INTERRUPTED_SEND_RECOVERY_MESSAGE,
  isDraftConflict,
  LOCAL_ATTACHMENT_DRAFT_MESSAGE,
  providerDraftEditBlock,
  type ComposerDraftPhase,
  type ComposerDraftRetryKind,
  type ComposerTerminalRecoveryKind,
} from "@/presentation/features/mail-workspace/composer-draft-state";
import type { MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import { useComposerDraftDiscard } from "@/presentation/features/mail-workspace/hooks/use-composer-draft-discard";
import { useComposerDraftPersistence } from "@/presentation/features/mail-workspace/hooks/use-composer-draft-persistence";
import { useComposerDraftRequest } from "@/presentation/features/mail-workspace/hooks/use-composer-draft-request";
import { useComposerDraftRestore } from "@/presentation/features/mail-workspace/hooks/use-composer-draft-restore";
import { useComposerTerminalDiscardReplay } from "@/presentation/features/mail-workspace/hooks/use-composer-terminal-discard-replay";
import type { ComposerRecoveryJournalPort } from "@/presentation/features/mail-workspace/hooks/use-composer-recovery-journal";
import { mailApi } from "@/transport/client/api-client";

interface ComposerDraftOptions {
  readonly accountKey: string; readonly composeId: DraftId;
  readonly content: DraftContent; readonly enabled: boolean;
  readonly handleSessionFailure: MailSessionFailureHandler;
  readonly hasLocalAttachments: boolean; readonly onDiscarded: () => void;
  readonly onHydrate: (draft: DraftDetail) => void;
  readonly onSaved: (draft: DraftDetail) => void;
  readonly recovery?: ComposerRecoveryJournalPort;
  readonly recoverySnapshot?: ComposerRecoverySnapshot;
}

export const useComposerDraft = ({
  accountKey, composeId, content, enabled, handleSessionFailure,
  hasLocalAttachments, onDiscarded, onHydrate, onSaved, recovery,
  recoverySnapshot,
}: ComposerDraftOptions) => {
  const [phase, setPhase] = useState<ComposerDraftPhase>("unsaved");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<DraftDetail | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [hasUserEdits, setHasUserEdits] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [requiresRecovery, setRequiresRecovery] = useState(false);
  const [retryKind, setRetryKind] = useState<ComposerDraftRetryKind>("none");
  const [terminalRecovery, setTerminalRecovery] =
    useState<ComposerTerminalRecoveryKind | null>(null);
  const [requestedId, setRequestedId] = useState<ProviderDraftId | null>(null);
  const [generation, setGeneration] = useState(0);
  const contentGeneration = useRef(0);
  const request = useComposerDraftRequest(accountKey);
  const { begin, finish, invalidate, isCurrent } = request;
  const persistence = useComposerDraftPersistence({
    accountKey, composeId, content, contentGeneration, enabled,
    handleSessionFailure, hasLocalAttachments, onHydrate, onSaved,
    ...(recovery ? { recovery } : {}),
    ...(recoverySnapshot ? { recoverySnapshot } : {}),
    requestedId, request, requiresRecovery, saved, setError,
    setHasUserEdits, setIsDirty, setPhase, setRequiresRecovery, setSaved,
    setRetryKind,
  });
  const resetPersistence = persistence.reset;
  const restorePending = persistence.restorePending;
  const isSaveInFlight = persistence.isInFlight;

  const reset = useCallback(() => {
    invalidate();
    contentGeneration.current = 0;
    setGeneration(0);
    resetPersistence();
    setError(null);
    setHasUserEdits(false);
    setIsDirty(false);
    setIsDiscarding(false);
    setIsLoading(false);
    setPhase("unsaved");
    setRequestedId(null);
    setRequiresRecovery(false);
    setRetryKind("none");
    setSaved(null);
    setTerminalRecovery(null);
  }, [invalidate, resetPersistence]);
  useEffect(() => reset, [reset]);
  useEffect(() => { reset(); }, [accountKey, reset]);
  const markUnsaved = useCallback(() => {
    if (terminalRecovery) return;
    contentGeneration.current += 1;
    setGeneration(contentGeneration.current);
    setHasUserEdits(true);
    setIsDirty(true);
    setError(null);
    setRetryKind("none");
    if (!isSaveInFlight()) setPhase("unsaved");
  }, [isSaveInFlight, terminalRecovery]);
  const markProgrammaticChange = useCallback(() => {
    if (terminalRecovery) return;
    contentGeneration.current += 1;
    setGeneration(contentGeneration.current);
    setIsDirty(true);
    setError(null);
    setRetryKind("none");
    if (!isSaveInFlight()) setPhase("unsaved");
  }, [isSaveInFlight, terminalRecovery]);

  useEffect(() => {
    if (hasLocalAttachments || error !== LOCAL_ATTACHMENT_DRAFT_MESSAGE) return;
    setError(null);
    setPhase(saved && !isDirty ? "saved" : "unsaved");
  }, [error, hasLocalAttachments, isDirty, saved]);

  const load = useCallback(
    async (providerDraftId: ProviderDraftId): Promise<boolean> => {
      const operation = begin();
      setRequestedId(providerDraftId);
      setError(null);
      setIsLoading(true);
      try {
        const draft = await mailApi.getDraft(
          providerDraftId, operation.accountKey, operation.controller.signal,
        );
        if (!isCurrent(operation)) return false;
        setSaved(draft);
        contentGeneration.current = 0;
        setHasUserEdits(false);
        setIsDirty(false);
        setRequiresRecovery(false);
        setRetryKind("none");
        onHydrate(draft);
        const editBlock = providerDraftEditBlock(draft);
        if (editBlock) {
          setError(editBlock);
          setRetryKind("blocked");
          setPhase("error");
          return false;
        }
        setPhase(draft.composeId ? "saved" : "unsaved");
        return true;
      } catch (nextError) {
        if (draftRequestAborted(nextError) || !isCurrent(operation)) {
          return false;
        }
        if (handleSessionFailure(nextError)) return false;
        setError(draftFailureMessage(nextError));
        setRetryKind("blocked");
        setPhase(isDraftConflict(nextError) ? "conflict" : "error");
        return false;
      } finally {
        if (finish(operation)) setIsLoading(false);
      }
    },
    [begin, finish, handleSessionFailure, isCurrent, onHydrate],
  );

  const restore = useComposerDraftRestore({
    contentGenerationRef: contentGeneration, handleSessionFailure, onHydrate,
    request, reset,
    restorePending, setError, setGeneration, setHasUserEdits, setIsDirty,
    setIsLoading, setPhase, setRequestedId, setRequiresRecovery, setRetryKind,
    setSaved,
    setTerminalRecovery,
  });
  const replayTerminalDiscard = useComposerTerminalDiscardReplay({
    accountKey, handleSessionFailure, onDiscarded, request,
  });
  const resolveTerminalRecovery = useCallback(async () => {
    if (!terminalRecovery || !recovery) return false;
    try {
      if (!await recovery.resumeTerminal()) {
        throw new Error("Couldn’t preserve this recovery copy.");
      }
      setRequiresRecovery(false);
      setRetryKind("none");
      setTerminalRecovery(null);
      setError(null);
      setPhase("unsaved");
      return true;
    } catch (nextError) {
      setError(draftFailureMessage(nextError));
      return false;
    }
  }, [recovery, terminalRecovery]);
  const markSendUncertain = useCallback(() => {
    setRequiresRecovery(true);
    setRetryKind("blocked");
    setTerminalRecovery("send");
    setError(INTERRUPTED_SEND_RECOVERY_MESSAGE);
    setPhase("error");
  }, []);

  const discard = useComposerDraftDiscard({
    accountKey, composeId, contentGeneration: generation,
    handleSessionFailure, onDiscarded,
    ...(recovery ? { recovery } : {}), request,
    ...(recoverySnapshot ? { recoverySnapshot } : {}),
    requested: requestedId !== null, requiresRecovery, reset, saved,
    setError, setIsDiscarding, setPhase,
  });

  const visiblePhase = hasLocalAttachments && phase === "saved" ? "unsaved" : phase;
  const availability = composerDraftAvailability({ hasLocalAttachments, isDirty,
    providerDraftRequested: requestedId !== null, requiresRecovery, saved,
    terminalRecovery });
  return {
    ...availability,
    autosave: persistence.autosave,
    canAttach: !saved && requestedId === null && phase !== "saving" &&
      !requiresRecovery,
    discard,
    enabled,
    error,
    contentGeneration: generation,
    hasUserEdits,
    hasUnsavedChanges: isDirty || hasLocalAttachments || requiresRecovery,
    isDiscarding, isLoading,
    load,
    markSendUncertain,
    markSent: reset,
    markUnsaved,
    markProgrammaticChange,
    phase: visiblePhase,
    loadFailed: requestedId !== null && !saved && !isLoading,
    providerDraft: saved?.composeId && availability.canSend
      ? { composeId: saved.composeId, id: saved.id, expectedRevision: saved.revision }
      : null,
    requiresDiscardConfirmation: saved !== null,
    reload: !requiresRecovery && (saved || requestedId)
      ? () => load(saved?.id ?? requestedId!)
      : null,
    requiresRecovery,
    replayTerminalDiscard,
    terminalRecovery,
    retryKind,
    restore,
    reset,
    clearRecovery: recovery?.clearForClose ?? (() => Promise.resolve()),
    retry: terminalRecovery
      ? resolveTerminalRecovery
      : requiresRecovery
      ? persistence.recover
      : requestedId && !saved ? () => load(requestedId) : persistence.save,
    save: persistence.save,
  };
};
