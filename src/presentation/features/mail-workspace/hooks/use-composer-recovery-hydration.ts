"use client";

import { useCallback, useMemo } from "react";

import type { ComposerRecoverySnapshot } from "@/presentation/features/mail-workspace/composer-recovery.types";
import type { useComposerAttachments } from "@/presentation/features/mail-workspace/hooks/use-composer-attachments";
import type { useComposerBody } from "@/presentation/features/mail-workspace/hooks/use-composer-body";
import type { useComposerFields } from "@/presentation/features/mail-workspace/hooks/use-composer-fields";
import type { useComposerSignatures } from "@/presentation/features/mail-workspace/hooks/use-composer-signatures";

export const useComposerRecoveryHydration = (
  fields: ReturnType<typeof useComposerFields>,
  body: ReturnType<typeof useComposerBody>,
  signatures: ReturnType<typeof useComposerSignatures>,
  attachments: ReturnType<typeof useComposerAttachments>,
) => {
  const snapshot = useMemo<ComposerRecoverySnapshot>(() => ({
    bcc: fields.bcc,
    body: body.recoveryBody,
    cc: fields.cc,
    hadLocalAttachments: attachments.attachmentIds.length > 0,
    ...(fields.inReplyTo ? { inReplyTo: fields.inReplyTo } : {}),
    signatureDisposition:
      signatures.configuration || signatures.isDetached ? "detached" : "none",
    subject: fields.subject,
    title: fields.title,
    to: fields.to,
  }), [attachments.attachmentIds.length, body.recoveryBody, fields.bcc, fields.cc,
    fields.inReplyTo, fields.subject, fields.title, fields.to,
    signatures.configuration, signatures.isDetached]);

  const restore = useCallback((value: ComposerRecoverySnapshot) => {
    fields.restoreRecovery(value);
    body.restoreRecovery(value.body);
    signatures.restoreRecovery(value.signatureDisposition);
  }, [body, fields, signatures]);

  return { restore, snapshot };
};
