import { canonicalComposerRecoveryJournal } from "@/presentation/features/mail-workspace/composer-recovery-schema";
import type { ComposerRecoveryJournal } from "@/presentation/features/mail-workspace/composer-recovery.types";
import type { ComposerDraftSaveAttempt } from "@/presentation/features/mail-workspace/composer-draft-save-attempt";

export const prepareComposerRecoverySave = (
  current: ComposerRecoveryJournal,
  attempt: ComposerDraftSaveAttempt,
): ComposerRecoveryJournal | null => {
  if (!attempt.providerDraftId || !attempt.expectedRevision) {
    if (attempt.providerDraftId || attempt.expectedRevision) return null;
    if (current.acknowledged) return null;
    return canonicalComposerRecoveryJournal({ ...current, pendingSave: attempt });
  }
  const acknowledged = current.acknowledged ?? (
    attempt.contentGeneration > 0
      ? {
          generation: 0,
          providerDraftId: attempt.providerDraftId,
          revision: attempt.expectedRevision,
        }
      : null
  );
  if (
    !acknowledged ||
    acknowledged.providerDraftId !== attempt.providerDraftId ||
    acknowledged.revision !== attempt.expectedRevision ||
    acknowledged.generation >= attempt.contentGeneration
  ) return null;
  return canonicalComposerRecoveryJournal({
    ...current,
    acknowledged,
    pendingSave: attempt,
  });
};
