"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { DraftDetail } from "@/domain/mail/draft";
import type {
  ComposerRecoveryCheckpoint,
  ComposerRecoveryJournalPort,
} from "@/presentation/features/mail-workspace/composer-recovery-journal.port";
import { canonicalComposerRecoveryJournal } from "@/presentation/features/mail-workspace/composer-recovery-schema";
import { prepareComposerRecoverySave } from "@/presentation/features/mail-workspace/composer-recovery-save-transition";
import {
  acknowledgeComposerRecovery,
  rejectComposerRecoverySave,
} from "@/presentation/features/mail-workspace/composer-recovery-transitions";
import {
  browserComposerRecoveryStorage,
  type ComposerRecoveryStorage,
} from "@/presentation/features/mail-workspace/composer-recovery-storage";
import type { ComposerRecoveryJournal, ComposerRecoveryOwner } from "@/presentation/features/mail-workspace/composer-recovery.types";
import type { ComposerDraftSaveAttempt } from "@/presentation/features/mail-workspace/composer-draft-save-attempt";
import { useComposerRecoverySelection } from "@/presentation/features/mail-workspace/hooks/use-composer-recovery-selection";
import { useComposerRecoveryTerminal } from "@/presentation/features/mail-workspace/hooks/use-composer-recovery-terminal";

export type { ComposerRecoveryCheckpoint, ComposerRecoveryJournalPort } from "@/presentation/features/mail-workspace/composer-recovery-journal.port";

const ownerKey = (owner: ComposerRecoveryOwner | null): string => owner
  ? [owner.accountId, owner.providerId, owner.sessionExpiresAt, owner.sessionScope]
      .join("\0")
  : "";

export const useComposerRecoveryJournal = (
  owner: ComposerRecoveryOwner | null,
  storageOverride?: ComposerRecoveryStorage | null,
) => {
  const ownerAccountId = owner?.accountId ?? null;
  const ownerProviderId = owner?.providerId ?? null;
  const ownerExpiresAt = owner?.sessionExpiresAt ?? null;
  const ownerSessionScope = owner?.sessionScope ?? null;
  const stableOwner = useMemo<ComposerRecoveryOwner | null>(() =>
    ownerAccountId && ownerProviderId && ownerExpiresAt && ownerSessionScope
      ? {
          accountId: ownerAccountId, providerId: ownerProviderId,
          sessionExpiresAt: ownerExpiresAt, sessionScope: ownerSessionScope,
        }
      : null,
  [ownerAccountId, ownerExpiresAt, ownerProviderId, ownerSessionScope]);
  const storage = useMemo(
    () => storageOverride === undefined
      ? browserComposerRecoveryStorage()
      : storageOverride,
    [storageOverride],
  );
  const [candidates, setCandidates] = useState<readonly ComposerRecoveryJournal[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [durableGeneration, setDurableGeneration] = useState<number | null>(null);
  const [latestGenerationValue, setLatestGenerationValue] = useState<number | null>(null);
  const active = useRef<ComposerRecoveryJournal | null>(null);
  const latestGeneration = useRef<number | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const lifecycle = useRef(0);
  const key = ownerKey(stableOwner);

  const enqueue = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.current.then(operation, operation);
    queue.current = result.then(() => undefined, () => undefined);
    return result;
  }, []);

  useEffect(() => {
    const epoch = ++lifecycle.current;
    active.current = null;
    latestGeneration.current = null;
    setCandidates([]);
    setDurableGeneration(null);
    setLatestGenerationValue(null);
    setStorageError(null);
    if (!stableOwner || !storage) return;
    setIsLoading(true);
    void storage.list(stableOwner).then((records) => {
      if (lifecycle.current === epoch) setCandidates(records);
    }).catch(() => {
      if (lifecycle.current === epoch) {
        setStorageError("Draft recovery storage is unavailable.");
      }
    }).finally(() => {
      if (lifecycle.current === epoch) setIsLoading(false);
    });
  }, [key, stableOwner, storage]);

  const persist = useCallback(async (
    journal: ComposerRecoveryJournal,
  ): Promise<boolean> => {
    if (!storage) {
      setStorageError("Draft recovery storage is unavailable.");
      return false;
    }
    const epoch = lifecycle.current;
    active.current = journal;
    const status = await enqueue(() => storage.write(journal));
    if (lifecycle.current !== epoch || active.current?.recordId !== journal.recordId) {
      return false;
    }
    if (status === "stored") {
      setDurableGeneration(journal.localGeneration);
      setStorageError(null);
      return true;
    }
    setStorageError("Couldn’t keep a recovery copy in this tab.");
    if (active.current === journal) active.current = null;
    return false;
  }, [enqueue, storage]);

  const nextJournal = useCallback((
    value: ComposerRecoveryCheckpoint,
  ): ComposerRecoveryJournal | null => {
    if (!stableOwner) return null;
    const current = active.current;
    const sameCompose = current?.composeId === value.composeId &&
      ownerKey(current.owner) === ownerKey(stableOwner);
    return canonicalComposerRecoveryJournal({
      ...(sameCompose && current ? current : {
        composeId: value.composeId,
        localGeneration: value.generation,
        owner: stableOwner,
        recordId: crypto.randomUUID(),
        snapshot: value.snapshot,
        storageRevision: 0,
        updatedAt: new Date().toISOString(),
        version: 1,
      }),
      localGeneration: value.generation,
      owner: stableOwner,
      snapshot: value.snapshot,
      storageRevision: (sameCompose && current ? current.storageRevision : 0) + 1,
      updatedAt: new Date().toISOString(),
    });
  }, [stableOwner]);

  const checkpoint = useCallback(async (
    value: ComposerRecoveryCheckpoint,
  ): Promise<boolean> => {
    latestGeneration.current = value.generation;
    setLatestGenerationValue(value.generation);
    try {
      const journal = nextJournal(value);
      return journal ? await persist(journal) : false;
    } catch {
      setStorageError("Couldn’t keep a recovery copy in this tab.");
      return false;
    }
  }, [nextJournal, persist]);

  const prepareSave = useCallback(async (
    attempt: ComposerDraftSaveAttempt,
    value: ComposerRecoveryCheckpoint,
  ): Promise<ComposerDraftSaveAttempt | null> => {
    latestGeneration.current = value.generation;
    setLatestGenerationValue(value.generation);
    try {
      const base = nextJournal(value);
      if (!base) return null;
      const journal = prepareComposerRecoverySave(base, attempt);
      if (!journal) return null;
      return await persist(journal) ? journal.pendingSave ?? null : null;
    } catch {
      setStorageError("Couldn’t safely prepare this draft save.");
      return null;
    }
  }, [nextJournal, persist]);

  const acknowledgeSave = useCallback(async (
    attempt: ComposerDraftSaveAttempt,
    draft: DraftDetail,
  ): Promise<void> => {
    const next = acknowledgeComposerRecovery(active.current, attempt, draft);
    if (!next) return;
    try {
      await persist(next);
    } catch {
      setStorageError("The mailbox saved this draft, but local recovery could not update.");
    }
  }, [persist]);

  const rejectSave = useCallback(async (
    attempt: ComposerDraftSaveAttempt,
  ): Promise<void> => {
    const next = rejectComposerRecoverySave(active.current, attempt);
    if (!next) return;
    try {
      await persist(next);
    } catch {
      setStorageError("Couldn’t update the local recovery copy.");
    }
  }, [persist]);

  const { activateCandidate, clearActive, discardCandidate } =
    useComposerRecoverySelection({
      activeRef: active, candidates, enqueue, latestGenerationRef: latestGeneration,
      setCandidates, setDurableGeneration,
      setLatestGeneration: setLatestGenerationValue, setStorageError, storage,
    });
  const {
    clearForClose, completeTerminal, markSendUncertain, prepareDiscard,
    prepareSend, rejectTerminal, resumeTerminal,
  } = useComposerRecoveryTerminal({
    activeRef: active, clearActive, nextJournal, persist,
  });

  const port = useMemo<ComposerRecoveryJournalPort>(() => ({
    acknowledgeSave, checkpoint, clearActive, clearForClose, completeTerminal,
    markSendUncertain, prepareDiscard, prepareSave, prepareSend, rejectSave,
    rejectTerminal, resumeTerminal,
  }), [acknowledgeSave, checkpoint, clearActive, clearForClose, completeTerminal,
    markSendUncertain, prepareDiscard, prepareSave, prepareSend, rejectSave,
    rejectTerminal, resumeTerminal]);
  return {
    activateCandidate,
    candidate: candidates[0] ?? null,
    discardCandidate,
    isLoading,
    localCheckpointCurrent:
      latestGenerationValue !== null && durableGeneration === latestGenerationValue,
    hasRecovery: durableGeneration !== null || Boolean(candidates[0]),
    port,
    storageError,
  };
};
