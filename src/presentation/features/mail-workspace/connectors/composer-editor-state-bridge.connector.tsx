"use client";

import { $generateHtmlFromNodes } from "@lexical/html";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { $getRoot, type LexicalEditor } from "lexical";
import { useEffect, useLayoutEffect, useRef } from "react";

import type { RichComposerSnapshot } from "@/presentation/features/mail-workspace/hooks/use-composer-body";

const snapshot = (editor: LexicalEditor): RichComposerSnapshot => ({
  html: $generateHtmlFromNodes(editor),
  text: $getRoot().getTextContent(),
});

export const ComposerEditorStateBridgeConnector = ({
  disabled,
  onChange,
  onInitialize,
}: {
  readonly disabled: boolean;
  readonly onChange: (value: RichComposerSnapshot) => void;
  readonly onInitialize?: (value: RichComposerSnapshot) => void;
}) => {
  const [editor] = useLexicalComposerContext();
  const initialized = useRef(false);
  useEffect(() => editor.setEditable(!disabled), [disabled, editor]);
  useLayoutEffect(() => {
    if (initialized.current || !onInitialize) return;
    initialized.current = true;
    editor.getEditorState().read(() => onInitialize(snapshot(editor)));
  }, [editor, onInitialize]);
  return (
    <OnChangePlugin
      ignoreSelectionChange
      onChange={(editorState) => {
        editorState.read(() => onChange(snapshot(editor)));
      }}
    />
  );
};
