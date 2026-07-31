"use client";

import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import type { ComposerRecoveryJournal } from "@/presentation/features/mail-workspace/composer-recovery.types";
import type { ComposerRecoveryStorage } from "@/presentation/features/mail-workspace/composer-recovery-storage";

interface ComposerRecoverySelectionOptions {
  readonly activeRef: MutableRefObject<ComposerRecoveryJournal | null>;
  readonly candidates: readonly ComposerRecoveryJournal[];
  readonly enqueue: (operation: () => Promise<void>) => Promise<void>;
  readonly latestGenerationRef: MutableRefObject<number | null>;
  readonly setCandidates: Dispatch<SetStateAction<readonly ComposerRecoveryJournal[]>>;
  readonly setDurableGeneration: Dispatch<SetStateAction<number | null>>;
  readonly setLatestGeneration: Dispatch<SetStateAction<number | null>>;
  readonly setStorageError: Dispatch<SetStateAction<string | null>>;
  readonly storage: ComposerRecoveryStorage | null;
}

const CLEAR_ERROR = "Couldn’t securely remove the local recovery copy.";

export const useComposerRecoverySelection = ({
  activeRef, candidates, enqueue, latestGenerationRef, setCandidates,
  setDurableGeneration, setLatestGeneration, setStorageError, storage,
}: ComposerRecoverySelectionOptions) => {
  const clearRecord = useCallback(async (
    journal: ComposerRecoveryJournal | null,
  ) => {
    if (!journal || !storage) return;
    await enqueue(() => storage.remove(journal.recordId));
  }, [enqueue, storage]);

  const clearActive = useCallback(async () => {
    const journal = activeRef.current;
    try {
      await clearRecord(journal);
    } catch (cause) {
      setStorageError(CLEAR_ERROR);
      throw new Error(CLEAR_ERROR, { cause });
    }
    if (activeRef.current?.recordId === journal?.recordId) activeRef.current = null;
    latestGenerationRef.current = null;
    setDurableGeneration(null);
    setLatestGeneration(null);
    setStorageError(null);
  }, [activeRef, clearRecord, latestGenerationRef, setDurableGeneration,
    setLatestGeneration, setStorageError]);

  const discardCandidate = useCallback(async () => {
    const [candidate] = candidates;
    if (!candidate) return;
    try {
      await clearRecord(candidate);
      setCandidates((current) => current.filter(
        ({ recordId }) => recordId !== candidate.recordId,
      ));
      setStorageError(null);
    } catch {
      setStorageError(CLEAR_ERROR);
    }
  }, [candidates, clearRecord, setCandidates, setStorageError]);

  const activateCandidate = useCallback((): ComposerRecoveryJournal | null => {
    const [candidate, ...remaining] = candidates;
    if (!candidate) return null;
    activeRef.current = candidate;
    latestGenerationRef.current = candidate.localGeneration;
    setDurableGeneration(candidate.localGeneration);
    setLatestGeneration(candidate.localGeneration);
    setCandidates(remaining);
    return candidate;
  }, [activeRef, candidates, latestGenerationRef, setCandidates,
    setDurableGeneration, setLatestGeneration]);

  return { activateCandidate, clearActive, discardCandidate };
};
