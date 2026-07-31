"use client";

import { useCallback, useRef, useState } from "react";

import type { EmailSignature } from "@/domain/member/email-signature";
import type { SignatureId } from "@/domain/shared/brand";
import type { EmailSignatureEditorDraft } from "@/presentation/features/mail-workspace/email-signature-editor-state";

interface RichInitializationIntent {
  readonly signatureId: SignatureId | null;
  readonly version: number;
}

export const useEmailSignatureRichInitialization = () => {
  const intent = useRef<RichInitializationIntent>({
    signatureId: null,
    version: 0,
  });
  const [version, setVersion] = useState(0);
  const remount = useCallback((signature: EmailSignature | null) => {
    const next = {
      signatureId: signature?.htmlBody ? signature.id : null,
      version: intent.current.version + 1,
    };
    intent.current = next;
    setVersion(next.version);
  }, []);
  const consume = useCallback(
    (
      draft: EmailSignatureEditorDraft,
      source: EmailSignature | null,
    ): boolean => {
      const current = intent.current;
      intent.current = { ...current, signatureId: null };
      return Boolean(
        current.version === version &&
          current.signatureId &&
          draft.mode === "rich" &&
          draft.signatureId === current.signatureId &&
          source?.id === current.signatureId &&
          source.htmlBody,
      );
    },
    [version],
  );
  return { consume, remount, version };
};
