"use client";

import type { ComposerRecoveryOwner } from "@/presentation/features/mail-workspace/composer-recovery.types";
import type { useComposerAttachments } from "@/presentation/features/mail-workspace/hooks/use-composer-attachments";
import type { useComposerBody } from "@/presentation/features/mail-workspace/hooks/use-composer-body";
import type { useComposerFields } from "@/presentation/features/mail-workspace/hooks/use-composer-fields";
import { useComposerRecoveryHydration } from "@/presentation/features/mail-workspace/hooks/use-composer-recovery-hydration";
import { useComposerRecoveryJournal } from "@/presentation/features/mail-workspace/hooks/use-composer-recovery-journal";
import type { useComposerSignatures } from "@/presentation/features/mail-workspace/hooks/use-composer-signatures";

export const useComposerRecovery = (
  owner: ComposerRecoveryOwner | null,
  fields: ReturnType<typeof useComposerFields>,
  body: ReturnType<typeof useComposerBody>,
  signatures: ReturnType<typeof useComposerSignatures>,
  attachments: ReturnType<typeof useComposerAttachments>,
) => ({
  hydration: useComposerRecoveryHydration(fields, body, signatures, attachments),
  journal: useComposerRecoveryJournal(owner),
});
