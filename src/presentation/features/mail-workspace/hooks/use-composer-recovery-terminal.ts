"use client";

import { useCallback, type MutableRefObject } from "react";

import type { ProviderDraftId } from "@/domain/shared/brand";
import { fingerprintComposerRecoverySend } from "@/presentation/features/mail-workspace/composer-recovery-send-fingerprint";
import { canonicalComposerRecoveryJournal } from "@/presentation/features/mail-workspace/composer-recovery-schema";
import {
  armComposerRecoveryDiscard,
  armComposerRecoverySend,
  markComposerRecoverySendUncertain,
  rejectComposerRecoveryTerminal,
} from "@/presentation/features/mail-workspace/composer-recovery-transitions";
import type {
  ComposerRecoveryJournal,
  ComposerRecoverySendRequest,
} from "@/presentation/features/mail-workspace/composer-recovery.types";

interface RecoveryCheckpoint {
  readonly composeId: ComposerRecoveryJournal["composeId"];
  readonly generation: number;
  readonly snapshot: ComposerRecoveryJournal["snapshot"];
}

interface RecoveryTerminalOptions {
  readonly activeRef: MutableRefObject<ComposerRecoveryJournal | null>;
  readonly clearActive: () => Promise<void>;
  readonly nextJournal: (value: RecoveryCheckpoint) => ComposerRecoveryJournal | null;
  readonly persist: (journal: ComposerRecoveryJournal) => Promise<boolean>;
}

export interface PreparedComposerRecoverySend {
  readonly intentId: string;
  readonly request: ComposerRecoverySendRequest;
}

export interface PreparedComposerRecoveryDiscard {
  readonly expectedRevision: string;
  readonly intentId: string;
  readonly providerDraftId: ProviderDraftId;
}

const timestamp = (): string => new Date().toISOString();
const matchesCheckpoint = (
  journal: ComposerRecoveryJournal | null,
  checkpoint: RecoveryCheckpoint,
): journal is ComposerRecoveryJournal => Boolean(
  journal &&
  journal.composeId === checkpoint.composeId &&
  journal.localGeneration === checkpoint.generation,
);

export const useComposerRecoveryTerminal = ({
  activeRef, clearActive, nextJournal, persist,
}: RecoveryTerminalOptions) => {
  const prepareBase = useCallback(async (
    value: RecoveryCheckpoint,
    acknowledgement?: {
      readonly providerDraftId: ProviderDraftId;
      readonly revision: string;
    },
  ): Promise<ComposerRecoveryJournal | null> => {
    const active = activeRef.current;
    if (active?.pendingSave || active?.terminalIntent) return null;
    let base = nextJournal(value);
    if (!base) return null;
    if (acknowledgement) {
      const current = active?.acknowledged;
      if (current && (current.providerDraftId !== acknowledgement.providerDraftId ||
        current.revision !== acknowledgement.revision)) return null;
      base = canonicalComposerRecoveryJournal({
        ...base,
        acknowledged: current ?? {
          generation: value.generation,
          ...acknowledgement,
        },
      });
    }
    return await persist(base) ? base : null;
  }, [activeRef, nextJournal, persist]);

  const prepareSend = useCallback(async (
    request: ComposerRecoverySendRequest,
    value: RecoveryCheckpoint,
  ): Promise<PreparedComposerRecoverySend | null> => {
    const fingerprinted = await fingerprintComposerRecoverySend(request);
    if (fingerprinted.request.draftId !== value.composeId) return null;
    const base = await prepareBase(value, fingerprinted.request.providerDraftId !== undefined ? {
      providerDraftId: fingerprinted.request.providerDraftId,
      revision: fingerprinted.request.expectedDraftRevision,
    } : undefined);
    if (!base) return null;
    const current = activeRef.current;
    if (!matchesCheckpoint(current, value) || current.pendingSave ||
      current.terminalIntent || current.recordId !== base.recordId) return null;
    const intentId = crypto.randomUUID();
    const armed = armComposerRecoverySend(current, {
      ...(fingerprinted.request.providerDraftId !== undefined ? {
        expectedDraftRevision: fingerprinted.request.expectedDraftRevision,
        providerDraftId: fingerprinted.request.providerDraftId,
      } : {}),
      intentId,
      issuedAt: timestamp(),
      requestFingerprint: fingerprinted.requestFingerprint,
    });
    if (!armed || !await persist(armed)) {
      return null;
    }
    const terminal = activeRef.current?.terminalIntent;
    if (terminal?.kind !== "send" || terminal.intentId !== intentId ||
      terminal.requestFingerprint !== fingerprinted.requestFingerprint) return null;
    return { intentId, request: fingerprinted.request };
  }, [activeRef, persist, prepareBase]);

  const prepareDiscard = useCallback(async (
    input: { readonly expectedRevision: string; readonly providerDraftId: ProviderDraftId },
    value: RecoveryCheckpoint,
  ): Promise<PreparedComposerRecoveryDiscard | null> => {
    const terminal = activeRef.current?.terminalIntent;
    if (terminal?.kind === "discard" &&
      terminal.providerDraftId === input.providerDraftId &&
      terminal.expectedRevision === input.expectedRevision) return terminal;
    const base = await prepareBase(value, {
      providerDraftId: input.providerDraftId,
      revision: input.expectedRevision,
    });
    if (!base) return null;
    const current = activeRef.current;
    if (!matchesCheckpoint(current, value) || current.pendingSave ||
      current.terminalIntent || current.recordId !== base.recordId) return null;
    const intentId = crypto.randomUUID();
    const armed = armComposerRecoveryDiscard(current, {
      ...input, intentId, issuedAt: timestamp(),
    });
    if (!armed || !await persist(armed) || armed.terminalIntent?.kind !== "discard") {
      return null;
    }
    return armed.terminalIntent;
  }, [activeRef, persist, prepareBase]);

  const transition = useCallback(async (
    intentId: string,
    update: typeof markComposerRecoverySendUncertain |
      typeof rejectComposerRecoveryTerminal,
  ): Promise<boolean> => {
    const next = update(activeRef.current, intentId, timestamp());
    return next ? persist(next) : false;
  }, [activeRef, persist]);

  const completeTerminal = useCallback(async (intentId: string) => {
    if (activeRef.current?.terminalIntent?.intentId !== intentId) return false;
    await clearActive();
    return true;
  }, [activeRef, clearActive]);
  const clearForClose = useCallback(async () => {
    if (activeRef.current?.terminalIntent) return;
    await clearActive();
  }, [activeRef, clearActive]);

  const resumeTerminal = useCallback(async (): Promise<boolean> => {
    const intentId = activeRef.current?.terminalIntent?.intentId;
    return intentId ? transition(intentId, rejectComposerRecoveryTerminal) : false;
  }, [activeRef, transition]);

  return {
    clearForClose,
    completeTerminal,
    markSendUncertain: useCallback((intentId: string) =>
      transition(intentId, markComposerRecoverySendUncertain), [transition]),
    prepareDiscard,
    prepareSend,
    resumeTerminal,
    rejectTerminal: useCallback((intentId: string) =>
      transition(intentId, rejectComposerRecoveryTerminal), [transition]),
  };
};
