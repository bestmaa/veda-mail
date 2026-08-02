"use client";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useEffect, useRef } from "react";

import {
  $applyComposerTemplate,
  type ComposerTemplateApplication,
} from "@/presentation/features/mail-workspace/composer-template-editor";

export const ComposerTemplateConnector = ({
  application,
  disabled,
  onApplied,
}: {
  readonly application: ComposerTemplateApplication | null;
  readonly disabled: boolean;
  readonly onApplied: (nonce: number) => void;
}) => {
  const [editor] = useLexicalComposerContext();
  const appliedNonce = useRef<number | null>(null);

  useEffect(() => {
    if (!application || disabled || appliedNonce.current === application.nonce) {
      return;
    }
    appliedNonce.current = application.nonce;
    editor.update(
      () => $applyComposerTemplate(editor, application),
      {
        discrete: true,
        onUpdate: () => {
          editor.focus();
          onApplied(application.nonce);
        },
        tag: "history-push",
      },
    );
  }, [application, disabled, editor, onApplied]);

  return null;
};
