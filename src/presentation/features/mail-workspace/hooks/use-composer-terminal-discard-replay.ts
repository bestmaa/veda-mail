"use client";

import { useCallback } from "react";

import { draftFailureMessage, draftRequestAborted } from "@/presentation/features/mail-workspace/composer-draft-state";
import { explicitComposerDiscardReplay } from "@/presentation/features/mail-workspace/composer-recovery-transitions";
import type { ComposerRecoveryJournal } from "@/presentation/features/mail-workspace/composer-recovery.types";
import type { useComposerDraftRequest } from "@/presentation/features/mail-workspace/hooks/use-composer-draft-request";
import type { MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import { mailApi } from "@/transport/client/api-client";
import { ApiClientError } from "@/transport/client/api-request";

export interface ComposerTerminalDiscardReplayResult {
  readonly completed: boolean;
  readonly error: string | null;
}

export const useComposerTerminalDiscardReplay = ({
  accountKey,
  handleSessionFailure,
  onDiscarded,
  request,
}: {
  readonly accountKey: string;
  readonly handleSessionFailure: MailSessionFailureHandler;
  readonly onDiscarded: () => void;
  readonly request: ReturnType<typeof useComposerDraftRequest>;
}) => useCallback(async (
  journal: ComposerRecoveryJournal,
): Promise<ComposerTerminalDiscardReplayResult> => {
  const terminal = journal.terminalIntent;
  const exact = terminal?.kind === "discard"
    ? explicitComposerDiscardReplay(journal, terminal.intentId)
    : null;
  if (!accountKey || !exact) {
    return { completed: false, error: "This discard recovery is invalid." };
  }
  const operation = request.begin();
  try {
    try {
      await mailApi.deleteDraft(
        exact.providerDraftId, exact.expectedRevision, operation.accountKey,
        operation.controller.signal,
      );
    } catch (error) {
      if (!(error instanceof ApiClientError && error.status === 404)) throw error;
    }
    if (!request.isCurrent(operation)) return { completed: false, error: null };
    onDiscarded();
    return { completed: true, error: null };
  } catch (error) {
    if (draftRequestAborted(error) || !request.isCurrent(operation)) {
      return { completed: false, error: null };
    }
    if (handleSessionFailure(error)) return { completed: false, error: null };
    return { completed: false, error: draftFailureMessage(error) };
  } finally {
    request.finish(operation);
  }
}, [accountKey, handleSessionFailure, onDiscarded, request]);
