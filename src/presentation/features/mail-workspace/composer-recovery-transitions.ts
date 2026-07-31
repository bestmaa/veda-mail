import type { DraftDetail } from "@/domain/mail/draft";
import type { ProviderDraftId } from "@/domain/shared/brand";
import { canonicalComposerRecoveryJournal } from "@/presentation/features/mail-workspace/composer-recovery-schema";
import type {
  ComposerRecoveryJournal,
  ComposerRecoveryTerminalIntent,
} from "@/presentation/features/mail-workspace/composer-recovery.types";
import type { ComposerDraftSaveAttempt } from "@/presentation/features/mail-workspace/composer-draft-save-attempt";

const matchingPending = (
  current: ComposerRecoveryJournal | null,
  attempt: ComposerDraftSaveAttempt,
): current is ComposerRecoveryJournal => Boolean(
  current?.pendingSave &&
  current.pendingSave.contentGeneration === attempt.contentGeneration,
);

const withoutPending = (
  current: ComposerRecoveryJournal,
): Omit<ComposerRecoveryJournal, "pendingSave"> => {
  const { pendingSave, ...journal } = current;
  void pendingSave;
  return journal;
};

interface TerminalTransitionInput {
  readonly intentId: string;
  readonly issuedAt: string;
}

export type ComposerSendIntentInput = TerminalTransitionInput & {
  readonly requestFingerprint: string;
} & (
  | {
      readonly expectedDraftRevision?: never;
      readonly providerDraftId?: never;
    }
  | {
      readonly expectedDraftRevision: string;
      readonly providerDraftId: ProviderDraftId;
    }
);

export interface ComposerDiscardIntentInput extends TerminalTransitionInput {
  readonly expectedRevision: string;
  readonly providerDraftId: ProviderDraftId;
}

export type ComposerTerminalRecoveryDirective =
  | {
      readonly action: "confirm-discard-replay";
      readonly expectedRevision: string;
      readonly intentId: string;
      readonly providerDraftId: ProviderDraftId;
    }
  | {
      readonly action: "check-sent";
      readonly intentId: string;
      readonly outcome: "uncertain";
    };

const canArmTerminal = (
  current: ComposerRecoveryJournal | null,
  issuedAt: string,
): current is ComposerRecoveryJournal => Boolean(
  current &&
  !current.pendingSave &&
  !current.terminalIntent &&
  Date.parse(issuedAt) >= Date.parse(current.updatedAt),
);

const terminalBase = (
  current: ComposerRecoveryJournal,
  input: TerminalTransitionInput,
) => ({
  composeId: current.composeId,
  generation: current.localGeneration,
  intentId: input.intentId,
  issuedAt: input.issuedAt,
  owner: {
    accountId: current.owner.accountId,
    providerId: current.owner.providerId,
    sessionScope: current.owner.sessionScope,
  },
});

const withTerminal = (
  current: ComposerRecoveryJournal,
  terminalIntent: ComposerRecoveryTerminalIntent,
): ComposerRecoveryJournal => canonicalComposerRecoveryJournal({
  ...current,
  storageRevision: current.storageRevision + 1,
  terminalIntent,
  updatedAt: terminalIntent.issuedAt,
});

export const armComposerRecoverySend = (
  current: ComposerRecoveryJournal | null,
  input: ComposerSendIntentInput,
): ComposerRecoveryJournal | null => canArmTerminal(current, input.issuedAt) &&
  (input.providerDraftId !== undefined
    ? current.acknowledged?.providerDraftId === input.providerDraftId &&
      current.acknowledged.revision === input.expectedDraftRevision
    : !current.acknowledged)
  ? withTerminal(current, {
      ...terminalBase(current, input),
      ...(input.providerDraftId !== undefined ? {
        expectedDraftRevision: input.expectedDraftRevision,
        providerDraftId: input.providerDraftId,
      } : {}),
      kind: "send",
      requestFingerprint: input.requestFingerprint,
      state: "armed",
    })
  : null;

export const armComposerRecoveryDiscard = (
  current: ComposerRecoveryJournal | null,
  input: ComposerDiscardIntentInput,
): ComposerRecoveryJournal | null =>
  canArmTerminal(current, input.issuedAt) &&
    current.acknowledged?.providerDraftId === input.providerDraftId &&
    current.acknowledged.revision === input.expectedRevision
    ? withTerminal(current, {
        ...terminalBase(current, input),
        expectedRevision: input.expectedRevision,
        kind: "discard",
        providerDraftId: input.providerDraftId,
        state: "armed",
      })
    : null;

export const markComposerRecoverySendUncertain = (
  current: ComposerRecoveryJournal | null,
  intentId: string,
  updatedAt: string,
): ComposerRecoveryJournal | null => {
  const terminal = current?.terminalIntent;
  if (
    !current || terminal?.kind !== "send" || terminal.intentId !== intentId ||
    Date.parse(updatedAt) < Date.parse(current.updatedAt)
  ) return null;
  if (terminal.state === "uncertain") return current;
  return canonicalComposerRecoveryJournal({
    ...current,
    storageRevision: current.storageRevision + 1,
    terminalIntent: { ...terminal, state: "uncertain" },
    updatedAt,
  });
};

export const rejectComposerRecoveryTerminal = (
  current: ComposerRecoveryJournal | null,
  intentId: string,
  updatedAt: string,
): ComposerRecoveryJournal | null => {
  const terminal = current?.terminalIntent;
  if (!current || terminal?.intentId !== intentId ||
    Date.parse(updatedAt) < Date.parse(current.updatedAt)) return null;
  const { terminalIntent, ...journal } = current;
  void terminalIntent;
  return canonicalComposerRecoveryJournal({
    ...journal,
    storageRevision: current.storageRevision + 1,
    updatedAt,
  });
};

/**
 * Maps persisted terminal state to reload UI. A send request is deliberately
 * never returned: every armed or uncertain send can only become `check-sent`.
 */
export const composerTerminalRecoveryDirective = (
  current: ComposerRecoveryJournal | null,
): ComposerTerminalRecoveryDirective | null => {
  const terminal = current?.terminalIntent;
  if (!terminal) return null;
  return terminal.kind === "send"
    ? { action: "check-sent", intentId: terminal.intentId, outcome: "uncertain" }
    : {
        action: "confirm-discard-replay",
        expectedRevision: terminal.expectedRevision,
        intentId: terminal.intentId,
        providerDraftId: terminal.providerDraftId,
      };
};

/** Returns the exact DELETE reference only after the UI confirms its intent ID. */
export const explicitComposerDiscardReplay = (
  current: ComposerRecoveryJournal | null,
  confirmedIntentId: string,
): Pick<ComposerDiscardIntentInput, "expectedRevision" | "providerDraftId"> | null => {
  const terminal = current?.terminalIntent;
  return terminal?.kind === "discard" && terminal.intentId === confirmedIntentId
    ? {
        expectedRevision: terminal.expectedRevision,
        providerDraftId: terminal.providerDraftId,
      }
    : null;
};

export const acknowledgeComposerRecovery = (
  current: ComposerRecoveryJournal | null,
  attempt: ComposerDraftSaveAttempt,
  draft: DraftDetail,
): ComposerRecoveryJournal | null => matchingPending(current, attempt)
  ? canonicalComposerRecoveryJournal({
      ...withoutPending(current),
      acknowledged: {
        generation: attempt.contentGeneration,
        providerDraftId: draft.id,
        revision: draft.revision,
      },
      storageRevision: current.storageRevision + 1,
      updatedAt: new Date().toISOString(),
    })
  : null;

export const rejectComposerRecoverySave = (
  current: ComposerRecoveryJournal | null,
  attempt: ComposerDraftSaveAttempt,
): ComposerRecoveryJournal | null => matchingPending(current, attempt)
  ? canonicalComposerRecoveryJournal({
      ...withoutPending(current),
      storageRevision: current.storageRevision + 1,
      updatedAt: new Date().toISOString(),
    })
  : null;
