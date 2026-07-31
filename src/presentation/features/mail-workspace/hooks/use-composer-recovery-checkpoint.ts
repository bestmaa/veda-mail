"use client";

import { useEffect } from "react";

import type { DraftId } from "@/domain/shared/brand";
import type { ComposerRecoverySnapshot } from "@/presentation/features/mail-workspace/composer-recovery.types";
import type { ComposerRecoveryJournalPort } from "@/presentation/features/mail-workspace/hooks/use-composer-recovery-journal";

export const useComposerRecoveryCheckpoint = ({
  composeId,
  enabled,
  generation,
  hasDurableIntent,
  isOpen,
  port,
  snapshot,
}: {
  readonly composeId: DraftId;
  readonly enabled: boolean;
  readonly generation: number;
  readonly hasDurableIntent: boolean;
  readonly isOpen: boolean;
  readonly port: ComposerRecoveryJournalPort;
  readonly snapshot: ComposerRecoverySnapshot;
}) => {
  useEffect(() => {
    if (!enabled || !isOpen || !hasDurableIntent) return;
    void port.checkpoint({ composeId, generation, snapshot });
  }, [composeId, enabled, generation, hasDurableIntent, isOpen, port, snapshot]);
};
