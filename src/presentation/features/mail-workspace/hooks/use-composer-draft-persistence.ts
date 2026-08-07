"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import type { DraftContent, DraftDetail } from "@/domain/mail/draft";
import type { DraftId, ProviderDraftId } from "@/domain/shared/brand";
import type { ComposerRecoverySnapshot } from "@/presentation/features/mail-workspace/composer-recovery.types";
import {
  completeDraftSave,
  DRAFT_RECOVERY_CONFLICT_MESSAGE,
  draftSaveRetryKind,
  draftFailureMessage,
  draftRequestAborted,
  isDraftConflict,
  isAmbiguousDraftSaveFailure,
  providerDraftEditBlock,
  type ComposerDraftPhase,
  type ComposerDraftRetryKind,
} from "@/presentation/features/mail-workspace/composer-draft-state";
import {
  composerDraftSaveAttempt,
  issueComposerDraftSaveAttempt,
  type ComposerDraftSaveAttempt,
} from "@/presentation/features/mail-workspace/composer-draft-save-attempt";
import type { useComposerDraftRequest } from "@/presentation/features/mail-workspace/hooks/use-composer-draft-request";
import type { ComposerRecoveryJournalPort } from "@/presentation/features/mail-workspace/hooks/use-composer-recovery-journal";
import type { MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";

interface ComposerDraftPersistenceOptions {
  readonly accountKey: string;
  readonly attachmentIds: readonly string[];
  readonly composeId: DraftId;
  readonly content: DraftContent;
  readonly contentGeneration: MutableRefObject<number>;
  readonly enabled: boolean;
  readonly handleSessionFailure: MailSessionFailureHandler;
  readonly onHydrate: (draft: DraftDetail) => void;
  readonly onSaved: (
    draft: DraftDetail,
    attempt: ComposerDraftSaveAttempt,
  ) => void;
  readonly recovery?: ComposerRecoveryJournalPort;
  readonly recoverySnapshot?: ComposerRecoverySnapshot;
  readonly retainedAttachmentIds: readonly string[];
  readonly requestedId: ProviderDraftId | null;
  readonly request: ReturnType<typeof useComposerDraftRequest>;
  readonly requiresRecovery: boolean;
  readonly saved: DraftDetail | null;
  readonly setError: Dispatch<SetStateAction<string | null>>;
  readonly setIsDirty: Dispatch<SetStateAction<boolean>>;
  readonly setHasUserEdits: Dispatch<SetStateAction<boolean>>;
  readonly setPhase: Dispatch<SetStateAction<ComposerDraftPhase>>;
  readonly setRequiresRecovery: Dispatch<SetStateAction<boolean>>;
  readonly setRetryKind: Dispatch<SetStateAction<ComposerDraftRetryKind>>;
  readonly setSaved: Dispatch<SetStateAction<DraftDetail | null>>;
}

export const useComposerDraftPersistence = ({
  accountKey, attachmentIds, composeId, content, contentGeneration, enabled,
  handleSessionFailure, onHydrate, onSaved, recovery,
  recoverySnapshot, requestedId, request, requiresRecovery, saved, setError,
  retainedAttachmentIds,
  setHasUserEdits, setIsDirty, setPhase, setRequiresRecovery, setRetryKind,
  setSaved,
}: ComposerDraftPersistenceOptions) => {
  const recoveryAttempt = useRef<ComposerDraftSaveAttempt | null>(null);
  const inFlight = useRef<Promise<DraftDetail | null> | null>(null);
  const savedRef = useRef(saved);
  useEffect(() => { savedRef.current = saved; }, [saved]);

  const persist = useCallback((
    attempt: ComposerDraftSaveAttempt,
    isRecovery: boolean,
    hydrateOnSuccess: boolean,
  ): Promise<DraftDetail | null> => {
    if (inFlight.current) return Promise.resolve(null);
    const run = (async (): Promise<DraftDetail | null> => {
      setError(null);
      setPhase("saving");
      let prepared: ComposerDraftSaveAttempt | null = attempt;
      try {
        if (recovery && recoverySnapshot) {
          prepared = await recovery.prepareSave(attempt, {
            composeId, generation: contentGeneration.current,
            snapshot: recoverySnapshot,
          });
        }
      } catch {
        prepared = null;
      }
      if (!prepared) {
        setError("Couldn’t keep a recovery copy, so this draft was not sent to the mailbox.");
        setRetryKind("backoff");
        setPhase("error");
        return null;
      }
      const operation = request.begin();
      try {
        const next = await issueComposerDraftSaveAttempt(
          prepared, operation.accountKey, operation.controller.signal,
        );
        if (!request.isCurrent(operation)) return null;
        recoveryAttempt.current = null;
        void recovery?.acknowledgeSave(prepared, next);
        savedRef.current = next;
        setSaved(next);
        setRequiresRecovery(false);
        setRetryKind("none");
        const completion = completeDraftSave(
          prepared.contentGeneration, contentGeneration.current,
        );
        if (!completion.isDirty && hydrateOnSuccess) onHydrate(next);
        setIsDirty(completion.isDirty);
        if (!completion.isDirty) setHasUserEdits(false);
        setPhase(completion.phase);
        onSaved(next, prepared);
        return next;
      } catch (error) {
        if (draftRequestAborted(error) || !request.isCurrent(operation)) return null;
        if (handleSessionFailure(error)) return null;
        const ambiguous = isAmbiguousDraftSaveFailure(error);
        setRetryKind(draftSaveRetryKind(error));
        recoveryAttempt.current = ambiguous ? prepared : null;
        setRequiresRecovery(ambiguous);
        if (!ambiguous) void recovery?.rejectSave(prepared);
        setError(isRecovery && isDraftConflict(error)
          ? DRAFT_RECOVERY_CONFLICT_MESSAGE : draftFailureMessage(error));
        setPhase(isDraftConflict(error) ? "conflict" : "error");
        return null;
      } finally {
        request.finish(operation);
      }
    })();
    const tracked = run.finally(() => {
      if (inFlight.current === tracked) inFlight.current = null;
    });
    inFlight.current = tracked;
    return tracked;
  }, [composeId, contentGeneration, handleSessionFailure, onHydrate, onSaved,
    recovery, recoverySnapshot, request, setError, setHasUserEdits, setIsDirty, setPhase,
    setRequiresRecovery, setRetryKind, setSaved]);

  const saveCurrent = useCallback(async (
    hydrateOnSuccess: boolean,
    waitForInFlight: boolean,
  ) => {
    const pending = inFlight.current;
    if (pending) {
      if (!waitForInFlight) return null;
      if (!await pending) return null;
    }
    const currentSaved = saved ?? savedRef.current;
    if (
      !enabled || !accountKey || requiresRecovery ||
      (requestedId && !currentSaved)
    ) {
      return null;
    }
    const latestSaved = currentSaved;
    const editBlock = providerDraftEditBlock(latestSaved);
    if (editBlock) {
      setError(editBlock);
      setPhase("error");
      return null;
    }
    return persist(composerDraftSaveAttempt(
      composeId, content, contentGeneration.current, latestSaved,
      attachmentIds, retainedAttachmentIds,
    ), false, hydrateOnSuccess);
  }, [accountKey, composeId, content, contentGeneration, enabled, saved,
    attachmentIds, persist, requestedId, requiresRecovery,
    retainedAttachmentIds,
    setError, setPhase]);

  return {
    autosave: useCallback(async () => Boolean(await saveCurrent(false, false)), [saveCurrent]),
    isInFlight: useCallback(() => inFlight.current !== null, []),
    recover: useCallback(() => {
      const attempt = recoveryAttempt.current;
      return attempt
        ? persist(attempt, true, false).then(Boolean)
        : Promise.resolve(false);
    }, [persist]),
    reset: useCallback(() => { recoveryAttempt.current = null; }, []),
    restorePending: useCallback((attempt: ComposerDraftSaveAttempt) => {
      recoveryAttempt.current = attempt;
    }, []),
    save: useCallback(async () => Boolean(await saveCurrent(true, true)), [saveCurrent]),
    saveDetail: useCallback(() => saveCurrent(true, true), [saveCurrent]),
  };
};
