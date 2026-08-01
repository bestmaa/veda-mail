"use client";

import { useCallback, useState, type Dispatch, type SetStateAction } from "react";

import { createComposerDraftStatus } from "@/presentation/features/mail-workspace/composer-draft-status";
import { composerTerminalRecoveryDirective } from "@/presentation/features/mail-workspace/composer-recovery-transitions";
import type { useComposerAttachments } from "@/presentation/features/mail-workspace/hooks/use-composer-attachments";
import { useComposerDraftAutosave } from "@/presentation/features/mail-workspace/hooks/use-composer-draft-autosave";
import type { useComposerDraft } from "@/presentation/features/mail-workspace/hooks/use-composer-draft";
import type { useComposerReturnFocus } from "@/presentation/features/mail-workspace/hooks/use-composer-focus";
import type { useComposerRecovery } from "@/presentation/features/mail-workspace/hooks/use-composer-recovery";
import { useComposerRecoveryCheckpoint } from "@/presentation/features/mail-workspace/hooks/use-composer-recovery-checkpoint";
import {
  shouldBlockComposerUnload,
  useComposerPageLifecycle,
} from "@/presentation/features/mail-workspace/hooks/use-composer-page-lifecycle";

export const useComposerRecoveryFlow = ({
  accountKey,
  attachments,
  autosaveEnabled,
  draft,
  enabled,
  hydration,
  isComposerReady,
  isOpen,
  journal,
  openAccountKey,
  paused,
  resetEditor,
  returnFocus,
  setConfirmClose,
  setConfirmDiscard,
  setError,
  setIsOpen,
  setOpenAccountKey,
}: {
  readonly accountKey: string;
  readonly attachments: ReturnType<typeof useComposerAttachments>;
  readonly autosaveEnabled: boolean;
  readonly draft: ReturnType<typeof useComposerDraft>;
  readonly enabled: boolean;
  readonly hydration: ReturnType<typeof useComposerRecovery>["hydration"];
  readonly isComposerReady: boolean;
  readonly isOpen: boolean;
  readonly journal: ReturnType<typeof useComposerRecovery>["journal"];
  readonly openAccountKey: string;
  readonly paused: boolean;
  readonly resetEditor: () => void;
  readonly returnFocus: ReturnType<typeof useComposerReturnFocus>;
  readonly setConfirmClose: Dispatch<SetStateAction<boolean>>;
  readonly setConfirmDiscard: Dispatch<SetStateAction<boolean>>;
  readonly setError: Dispatch<SetStateAction<string | null>>;
  readonly setIsOpen: Dispatch<SetStateAction<boolean>>;
  readonly setOpenAccountKey: Dispatch<SetStateAction<string>>;
}) => {
  const [dismissedRecordId, setDismissedRecordId] = useState<string | null>(null);
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [isTerminalBusy, setIsTerminalBusy] = useState(false);
  const hasLocalAttachments = attachments.attachments.length > 0;
  const hasDurableIntent = draft.hasUserEdits || hasLocalAttachments ||
    draft.requiresRecovery;
  const composerOpen = isOpen && openAccountKey === accountKey;
  const autosave = useComposerDraftAutosave({
    autosave: draft.autosave,
    contentGeneration: draft.contentGeneration,
    enabled: autosaveEnabled && isComposerReady && composerOpen,
    hasLocalAttachments,
    hasUserEdits: draft.hasUserEdits,
    paused: paused || draft.isDiscarding || draft.isLoading ||
      draft.phase === "saving",
    reconcile: draft.retry,
    retryKind: draft.retryKind,
  });
  useComposerRecoveryCheckpoint({
    composeId: attachments.draftId,
    enabled,
    generation: draft.contentGeneration,
    hasDurableIntent,
    isOpen: composerOpen,
    port: journal.port,
    snapshot: hydration.snapshot,
  });
  useComposerPageLifecycle(shouldBlockComposerUnload({
    hasDurableIntent,
    hasLocalAttachments,
    isOpen: composerOpen,
    localCheckpointCurrent: journal.localCheckpointCurrent,
  }));

  const restore = useCallback(async () => {
    if (!accountKey || !enabled || !isComposerReady || isOpen) return;
    const pending = journal.candidate;
    const directive = composerTerminalRecoveryDirective(pending);
    if (pending && directive?.action === "confirm-discard-replay") {
      setTerminalError(null);
      setIsTerminalBusy(true);
      try {
        const result = await draft.replayTerminalDiscard(pending);
        if (result.completed) await journal.discardCandidate();
        setTerminalError(result.error);
      } finally {
        setIsTerminalBusy(false);
      }
      return;
    }
    const candidate = journal.activateCandidate();
    if (!candidate) return;
    returnFocus.remember();
    const restoring = draft.restore(candidate);
    resetEditor();
    attachments.discard(true);
    attachments.adoptDraftId(candidate.composeId);
    hydration.restore(candidate.snapshot);
    setConfirmClose(false);
    setConfirmDiscard(false);
    setError(null);
    setOpenAccountKey(accountKey);
    setIsOpen(true);
    await restoring;
  }, [accountKey, attachments, draft, enabled, hydration, isComposerReady,
    isOpen, journal, resetEditor, returnFocus, setConfirmClose,
    setConfirmDiscard, setError, setIsOpen, setOpenAccountKey]);

  const candidate = journal.candidate;
  const terminalDirective = composerTerminalRecoveryDirective(candidate);
  const isTerminalSend = terminalDirective?.action === "check-sent";
  const isTerminalDiscard = terminalDirective?.action ===
    "confirm-discard-replay";
  const isDismissed = candidate?.recordId === dismissedRecordId;
  const dismiss = () => setDismissedRecordId(candidate?.recordId ?? null);
  const terminalDescription = isTerminalSend
    ? "A send request may already have completed. Check Sent first. Veda Mail will never resend this recovery automatically."
    : "You previously confirmed permanent discard. Veda Mail can retry only that exact draft ID and revision; an already absent draft counts as complete.";

  return {
    hasCandidate: Boolean(candidate) && !isDismissed,
    hasPersistedRecovery: journal.hasRecovery,
    prompt: {
      description: isTerminalSend || isTerminalDiscard
        ? terminalDescription
        : "An interrupted draft from this mailbox session is available. Its recipients and message stay hidden until you choose Restore draft.",
      error: terminalError ?? journal.storageError,
      hadLocalAttachments: candidate?.snapshot.hadLocalAttachments ?? false,
      initialFocus: isTerminalDiscard ? "secondary" as const : "primary" as const,
      isLoading: journal.isLoading || isTerminalBusy,
      isOpen: Boolean(candidate) && !isDismissed && enabled &&
        isComposerReady && !isOpen,
      onDismiss: dismiss,
      onPrimary: restore,
      onSecondary: isTerminalSend || isTerminalDiscard
        ? dismiss
        : journal.discardCandidate,
      primaryLabel: isTerminalSend ? "Review copy safely"
        : isTerminalDiscard ? "Finish exact discard" : "Restore draft",
      secondaryLabel: isTerminalSend || isTerminalDiscard
        ? "Not now" : "Discard recovery copy",
      title: isTerminalSend ? "Check Sent before continuing"
        : isTerminalDiscard ? "Finish interrupted discard?"
        : "Restore interrupted draft?",
    },
    status: createComposerDraftStatus({
      autosave,
      enabled,
      hasLocalAttachments,
      hasUserEdits: draft.hasUserEdits,
      localCheckpointCurrent: journal.localCheckpointCurrent,
      phase: draft.phase,
      storageError: journal.storageError,
    }),
  };
};
