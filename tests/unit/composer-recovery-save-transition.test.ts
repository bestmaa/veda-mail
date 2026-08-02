import { describe, expect, it } from "vitest";

import { id } from "@/domain/shared/brand";
import { prepareComposerRecoverySave } from "@/presentation/features/mail-workspace/composer-recovery-save-transition";
import { recoveryJournal } from "./composer-recovery-fixture";

const providerDraftId = id.providerDraft("provider-draft-a");
const updateAttempt = {
  ...recoveryJournal().pendingSave!,
  contentGeneration: 1,
  expectedRevision: "revision-a",
  providerDraftId,
};
const unacknowledgedJournal = (localGeneration: number) => {
  const { acknowledged, pendingSave, ...current } = recoveryJournal();
  void acknowledged; void pendingSave;
  return { ...current, localGeneration };
};

describe("composer recovery save transition", () => {
  it("seeds the loaded provider draft acknowledgement before its first update", () => {
    const current = unacknowledgedJournal(7);

    const prepared = prepareComposerRecoverySave(current, {
      ...updateAttempt,
      contentGeneration: 7,
    });

    expect(prepared?.acknowledged).toEqual({
      generation: 0,
      providerDraftId,
      revision: "revision-a",
    });
    expect(prepared?.pendingSave).toMatchObject({
      ...updateAttempt,
      contentGeneration: 7,
    });
  });

  it("fails closed for an unchanged or mismatched provider draft", () => {
    const current = unacknowledgedJournal(0);
    expect(prepareComposerRecoverySave(current, {
      ...updateAttempt,
      contentGeneration: 0,
    })).toBeNull();
    expect(prepareComposerRecoverySave({
      ...unacknowledgedJournal(1),
      acknowledged: {
        generation: 0,
        providerDraftId,
        revision: "other-revision",
      },
    }, updateAttempt)).toBeNull();
  });
});
