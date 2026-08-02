import { describe, expect, it, vi } from "vitest";

vi.mock("react", () => ({
  useEffect: (effect: () => void) => effect(),
}));

import { id } from "@/domain/shared/brand";
import type { ComposerRecoveryJournalPort } from "@/presentation/features/mail-workspace/composer-recovery-journal.port";
import { useComposerRecoveryCheckpoint } from "@/presentation/features/mail-workspace/hooks/use-composer-recovery-checkpoint";
import { recoverySnapshot } from "./composer-recovery-fixture";

const options = (
  checkpoint: ReturnType<typeof vi.fn>,
  paused: boolean,
) => ({
  composeId: id.draft("11111111-1111-4111-8111-111111111111"),
  enabled: true,
  generation: 4,
  hasDurableIntent: true,
  isOpen: true,
  paused,
  port: { checkpoint } as unknown as ComposerRecoveryJournalPort,
  snapshot: recoverySnapshot(),
});

describe("composer recovery checkpoint", () => {
  it("does not persist an intermediate template application snapshot", () => {
    const checkpoint = vi.fn(async () => true);
    useComposerRecoveryCheckpoint(options(checkpoint, true));
    expect(checkpoint).not.toHaveBeenCalled();
  });

  it("resumes checkpointing after the template application commits", () => {
    const checkpoint = vi.fn(async () => true);
    useComposerRecoveryCheckpoint(options(checkpoint, false));
    expect(checkpoint).toHaveBeenCalledWith(expect.objectContaining({
      generation: 4,
      snapshot: recoverySnapshot(),
    }));
  });
});
