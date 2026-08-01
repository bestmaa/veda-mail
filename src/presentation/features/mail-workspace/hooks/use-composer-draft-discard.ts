"use client";

import { useCallback, useRef, type Dispatch, type SetStateAction } from "react";

import type { DraftDetail } from "@/domain/mail/draft";
import type { DraftId } from "@/domain/shared/brand";
import type { ComposerRecoverySnapshot } from "@/presentation/features/mail-workspace/composer-recovery.types";
import {
  draftFailureMessage, draftRequestAborted, isAmbiguousDraftSaveFailure,
  isDraftConflict, type ComposerDraftPhase,
} from "@/presentation/features/mail-workspace/composer-draft-state";
import type { ComposerRecoveryJournalPort } from "@/presentation/features/mail-workspace/hooks/use-composer-recovery-journal";
import type { MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import type { useComposerDraftRequest } from "@/presentation/features/mail-workspace/hooks/use-composer-draft-request";
import { mailApi } from "@/transport/client/api-client";
import { ApiClientError } from "@/transport/client/api-request";

interface ComposerDraftDiscardOptions {
  readonly accountKey: string;
  readonly composeId: DraftId;
  readonly contentGeneration: number;
  readonly handleSessionFailure: MailSessionFailureHandler;
  readonly onDiscarded: () => void;
  readonly recovery?: ComposerRecoveryJournalPort;
  readonly recoverySnapshot?: ComposerRecoverySnapshot;
  readonly request: ReturnType<typeof useComposerDraftRequest>;
  readonly requested: boolean;
  readonly requiresRecovery: boolean;
  readonly reset: () => void;
  readonly saved: DraftDetail | null;
  readonly setError: Dispatch<SetStateAction<string | null>>;
  readonly setIsDiscarding: Dispatch<SetStateAction<boolean>>;
  readonly setPhase: Dispatch<SetStateAction<ComposerDraftPhase>>;
}

export const useComposerDraftDiscard = ({
  accountKey, composeId, contentGeneration, handleSessionFailure, onDiscarded,
  recovery, recoverySnapshot, request, requested, requiresRecovery, reset,
  saved, setError, setIsDiscarding, setPhase,
}: ComposerDraftDiscardOptions) => {
  const inFlight = useRef(false);
  return useCallback(async (): Promise<boolean> => {
    if (!accountKey || requiresRecovery || (requested && !saved) || inFlight.current) {
      return false;
    }
    inFlight.current = true;
    if (!saved) {
      setError(null);
      setIsDiscarding(true);
      try {
        await recovery?.clearActive();
        reset();
        onDiscarded();
        return true;
      } catch (error) {
        setError(draftFailureMessage(error));
        setPhase("error");
        return false;
      } finally {
        inFlight.current = false;
        setIsDiscarding(false);
      }
    }
    setError(null);
    setIsDiscarding(true);
    let intentId: string | null = null;
    let operation: ReturnType<typeof request.begin> | null = null;
    try {
      const prepared = recovery && recoverySnapshot
        ? await recovery.prepareDiscard(
            { expectedRevision: saved.revision, providerDraftId: saved.id },
            { composeId, generation: contentGeneration, snapshot: recoverySnapshot },
          )
        : recovery ? null : {
            expectedRevision: saved.revision, intentId: "", providerDraftId: saved.id,
          };
      if (!prepared) throw new Error(
        "Couldn’t secure this discard attempt. Keep this tab open and retry.",
      );
      intentId = prepared.intentId || null;
      operation = request.begin();
      try {
        await mailApi.deleteDraft(
          prepared.providerDraftId, prepared.expectedRevision,
          operation.accountKey, operation.controller.signal,
        );
      } catch (error) {
        if (!(error instanceof ApiClientError && error.status === 404)) throw error;
      }
      if (!request.isCurrent(operation)) return false;
      if (intentId) {
        if (!await recovery?.completeTerminal(intentId)) {
          throw new Error("The draft was discarded, but its recovery copy remains.");
        }
      } else await recovery?.clearActive();
      reset();
      onDiscarded();
      return true;
    } catch (error) {
      if (draftRequestAborted(error) ||
        (operation && !request.isCurrent(operation))) return false;
      if (handleSessionFailure(error)) return false;
      if (intentId && !isAmbiguousDraftSaveFailure(error)) {
        await recovery?.rejectTerminal(intentId).catch(() => false);
      }
      setError(draftFailureMessage(error));
      setPhase(isDraftConflict(error) ? "conflict" : "error");
      return false;
    } finally {
      inFlight.current = false;
      if (!operation || request.finish(operation)) setIsDiscarding(false);
    }
  }, [accountKey, composeId, contentGeneration, handleSessionFailure,
    onDiscarded, recovery, recoverySnapshot, request, requested,
    requiresRecovery, reset, saved, setError, setIsDiscarding, setPhase]);
};
