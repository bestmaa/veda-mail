"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { DraftContent, DraftDetail } from "@/domain/mail/draft";
import type { DraftId, ProviderDraftId } from "@/domain/shared/brand";
import {
  completeDraftSave,
  composerDraftAvailability,
  DRAFT_RECOVERY_CONFLICT_MESSAGE,
  draftFailureMessage,
  draftRequestAborted,
  isDraftConflict,
  LOCAL_ATTACHMENT_DRAFT_MESSAGE,
  providerDraftEditBlock,
  type ComposerDraftPhase,
} from "@/presentation/features/mail-workspace/composer-draft-state";
import {
  composerDraftSaveAttempt,
  issueComposerDraftSaveAttempt,
  type ComposerDraftSaveAttempt,
} from "@/presentation/features/mail-workspace/composer-draft-save-attempt";
import type { MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import { useComposerDraftRequest } from "@/presentation/features/mail-workspace/hooks/use-composer-draft-request";
import { mailApi } from "@/transport/client/api-client";

interface ComposerDraftOptions {
  readonly accountKey: string; readonly composeId: DraftId;
  readonly content: DraftContent; readonly enabled: boolean;
  readonly handleSessionFailure: MailSessionFailureHandler;
  readonly hasLocalAttachments: boolean; readonly onDiscarded: () => void;
  readonly onHydrate: (draft: DraftDetail) => void;
  readonly onSaved: (draft: DraftDetail) => void;
}

export const useComposerDraft = ({
  accountKey, composeId, content, enabled, handleSessionFailure,
  hasLocalAttachments, onDiscarded, onHydrate, onSaved,
}: ComposerDraftOptions) => {
  const [phase, setPhase] = useState<ComposerDraftPhase>("unsaved");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<DraftDetail | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [requiresRecovery, setRequiresRecovery] = useState(false);
  const [requestedId, setRequestedId] = useState<ProviderDraftId | null>(null);
  const contentGeneration = useRef(0);
  const recoveryAttempt = useRef<ComposerDraftSaveAttempt | null>(null);
  const discardInFlight = useRef(false);
  const saveInFlight = useRef(false);
  const { begin, finish, invalidate, isCurrent } = useComposerDraftRequest(accountKey);

  const reset = useCallback(() => {
    invalidate();
    contentGeneration.current = 0;
    recoveryAttempt.current = null;
    setError(null);
    setIsDirty(false);
    setIsDiscarding(false);
    setIsLoading(false);
    setPhase("unsaved");
    setRequestedId(null);
    setRequiresRecovery(false);
    setSaved(null);
  }, [invalidate]);

  useEffect(() => reset, [reset]);
  useEffect(() => { reset(); }, [accountKey, reset]);

  const markUnsaved = useCallback(() => {
    contentGeneration.current += 1;
    setIsDirty(true);
    setError(null);
    setPhase("unsaved");
  }, []);

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
        setIsDirty(false);
        setRequiresRecovery(false);
        onHydrate(draft);
        const editBlock = providerDraftEditBlock(draft);
        if (editBlock) {
          setError(editBlock);
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
        setPhase(isDraftConflict(nextError) ? "conflict" : "error");
        return false;
      } finally {
        if (finish(operation)) setIsLoading(false);
      }
    },
    [begin, finish, handleSessionFailure, isCurrent, onHydrate],
  );

  const persist = useCallback(async (
    attempt: ComposerDraftSaveAttempt,
    isRecovery: boolean,
  ): Promise<boolean> => {
    if (saveInFlight.current) return false;
    const operation = begin();
    saveInFlight.current = true;
    setError(null);
    setPhase("saving");
    try {
      const next = await issueComposerDraftSaveAttempt(
        attempt, operation.accountKey, operation.controller.signal,
      );
      if (!isCurrent(operation)) return false;
      recoveryAttempt.current = null;
      setSaved(next);
      setRequiresRecovery(false);
      const completion = completeDraftSave(
        attempt.contentGeneration, contentGeneration.current);
      if (!completion.isDirty) onHydrate(next);
      setIsDirty(completion.isDirty);
      setPhase(completion.phase);
      onSaved(next);
      return true;
    } catch (nextError) {
      if (draftRequestAborted(nextError) || !isCurrent(operation)) {
        return false;
      }
      if (handleSessionFailure(nextError)) return false;
      recoveryAttempt.current = attempt;
      setRequiresRecovery(true);
      setError(isRecovery && isDraftConflict(nextError)
        ? DRAFT_RECOVERY_CONFLICT_MESSAGE
        : draftFailureMessage(nextError));
      setPhase(isDraftConflict(nextError) ? "conflict" : "error");
      return false;
    } finally {
      saveInFlight.current = false;
      finish(operation);
    }
  }, [begin, finish, handleSessionFailure, isCurrent, onHydrate, onSaved]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!enabled || !accountKey || requiresRecovery || (requestedId && !saved)) return false;
    const editBlock = providerDraftEditBlock(saved);
    if (editBlock || hasLocalAttachments) {
      setError(editBlock ?? LOCAL_ATTACHMENT_DRAFT_MESSAGE);
      setPhase("error");
      return false;
    }
    return persist(composerDraftSaveAttempt(
      composeId, content, contentGeneration.current, saved,
    ), false);
  }, [accountKey, composeId, content, enabled, hasLocalAttachments,
    persist, requestedId, requiresRecovery, saved]);

  const recover = useCallback((): Promise<boolean> => {
    const attempt = recoveryAttempt.current;
    return attempt ? persist(attempt, true) : Promise.resolve(false);
  }, [persist]);

  const discard = useCallback(async (): Promise<boolean> => {
    if (requiresRecovery || (requestedId && !saved)) return false;
    if (discardInFlight.current) return false;
    discardInFlight.current = true;
    if (!saved) {
      reset();
      onDiscarded();
      discardInFlight.current = false;
      return true;
    }
    const operation = begin();
    setError(null);
    setIsDiscarding(true);
    try {
      await mailApi.deleteDraft(
        saved.id, saved.revision, operation.accountKey, operation.controller.signal,
      );
      if (!isCurrent(operation)) return false;
      reset();
      onDiscarded();
      return true;
    } catch (nextError) {
      if (draftRequestAborted(nextError) || !isCurrent(operation)) {
        return false;
      }
      if (handleSessionFailure(nextError)) return false;
      setError(draftFailureMessage(nextError));
      setPhase(isDraftConflict(nextError) ? "conflict" : "error");
      return false;
    } finally {
      discardInFlight.current = false;
      if (finish(operation)) setIsDiscarding(false);
    }
  }, [begin, finish, handleSessionFailure, isCurrent, onDiscarded,
    requestedId, requiresRecovery, reset, saved]);

  const visiblePhase = hasLocalAttachments && phase === "saved" ? "unsaved" : phase;
  const availability = composerDraftAvailability({ hasLocalAttachments, isDirty,
    providerDraftRequested: requestedId !== null, requiresRecovery, saved });
  return {
    ...availability,
    discard,
    enabled,
    error,
    hasUnsavedChanges: isDirty || hasLocalAttachments || requiresRecovery,
    isDiscarding, isLoading,
    load,
    markSent: reset,
    markUnsaved,
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
    reset,
    retry: requiresRecovery
      ? recover
      : requestedId && !saved ? () => load(requestedId) : save,
    save,
  };
};
