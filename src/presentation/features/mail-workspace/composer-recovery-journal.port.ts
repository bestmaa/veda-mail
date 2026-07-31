import type { DraftDetail } from "@/domain/mail/draft";
import type { DraftId } from "@/domain/shared/brand";
import type {
  ComposerRecoverySendRequest,
  ComposerRecoverySnapshot,
} from "@/presentation/features/mail-workspace/composer-recovery.types";
import type { ComposerDraftSaveAttempt } from "@/presentation/features/mail-workspace/composer-draft-save-attempt";
import type {
  PreparedComposerRecoveryDiscard,
  PreparedComposerRecoverySend,
} from "@/presentation/features/mail-workspace/hooks/use-composer-recovery-terminal";

export interface ComposerRecoveryCheckpoint {
  readonly composeId: DraftId;
  readonly generation: number;
  readonly snapshot: ComposerRecoverySnapshot;
}

export interface ComposerRecoveryJournalPort {
  readonly acknowledgeSave: (
    attempt: ComposerDraftSaveAttempt,
    draft: DraftDetail,
  ) => Promise<void>;
  readonly checkpoint: (value: ComposerRecoveryCheckpoint) => Promise<boolean>;
  readonly clearActive: () => Promise<void>;
  readonly clearForClose: () => Promise<void>;
  readonly completeTerminal: (intentId: string) => Promise<boolean>;
  readonly markSendUncertain: (intentId: string) => Promise<boolean>;
  readonly prepareDiscard: (
    input: {
      readonly expectedRevision: string;
      readonly providerDraftId: DraftDetail["id"];
    },
    value: ComposerRecoveryCheckpoint,
  ) => Promise<PreparedComposerRecoveryDiscard | null>;
  readonly prepareSave: (
    attempt: ComposerDraftSaveAttempt,
    value: ComposerRecoveryCheckpoint,
  ) => Promise<ComposerDraftSaveAttempt | null>;
  readonly prepareSend: (
    request: ComposerRecoverySendRequest,
    value: ComposerRecoveryCheckpoint,
  ) => Promise<PreparedComposerRecoverySend | null>;
  readonly rejectSave: (attempt: ComposerDraftSaveAttempt) => Promise<void>;
  readonly rejectTerminal: (intentId: string) => Promise<boolean>;
  readonly resumeTerminal: () => Promise<boolean>;
}
