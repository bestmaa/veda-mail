"use client";

import { $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import {
  $getSelection,
  $isRangeSelection,
  $setSelection,
  COMMAND_PRIORITY_LOW,
  KEY_DOWN_COMMAND,
  type LexicalEditor,
  type RangeSelection,
} from "lexical";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEventHandler,
  type KeyboardEventHandler,
} from "react";

import { normalizeComposerLink } from "@/presentation/features/mail-workspace/composer-body-content";
import { nearestComposerLink } from "@/presentation/features/mail-workspace/composer-editor-selection";

export const useComposerEditorLink = (
  editor: LexicalEditor,
  disabled: boolean,
) => {
  const [isLinkEditorOpen, setIsLinkEditorOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const savedSelection = useRef<RangeSelection | null>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const disabledRef = useRef(disabled);

  useEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);

  const restoreSelection = useCallback(() => {
    const selection = savedSelection.current;
    if (!selection) return false;
    editor.update(() => $setSelection(selection.clone()));
    return true;
  }, [editor]);

  const onLink = useCallback(() => {
    if (disabledRef.current) return;
    let selection: RangeSelection | null = null;
    let existingUrl = "";
    editor.getEditorState().read(() => {
      const current = $getSelection();
      if (!$isRangeSelection(current) || current.isCollapsed()) return;
      selection = current.clone();
      const link = nearestComposerLink(current.anchor.getNode());
      if ($isLinkNode(link)) existingUrl = link.getURL();
    });
    if (!selection) {
      setStatusMessage("Select message text before inserting a link.");
      return;
    }
    savedSelection.current = selection;
    setStatusMessage("");
    setLinkValue(existingUrl);
    setLinkError(null);
    setIsLinkEditorOpen(true);
  }, [editor]);

  const closeLinkEditor = useCallback(() => {
    setIsLinkEditorOpen(false);
    setLinkError(null);
    if (!disabledRef.current) {
      restoreSelection();
      editor.focus();
    }
    savedSelection.current = null;
  }, [editor, restoreSelection]);

  const onApplyLink = useCallback(() => {
    if (disabledRef.current) return;
    const url = normalizeComposerLink(linkValue);
    if (!url) {
      setLinkError("Use an absolute http, https, or mailto address.");
      return;
    }
    if (!restoreSelection()) return;
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, {
      rel: "noopener noreferrer",
      target: "_blank",
      url,
    });
    closeLinkEditor();
  }, [closeLinkEditor, editor, linkValue, restoreSelection]);

  const onRemoveLink = useCallback(() => {
    if (disabledRef.current) return;
    if (restoreSelection()) editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
    closeLinkEditor();
  }, [closeLinkEditor, editor, restoreSelection]);

  const onLinkKeyDown: KeyboardEventHandler<HTMLDivElement> = useCallback(
    (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeLinkEditor();
      } else if (
        event.key === "Enter" &&
        event.target === linkInputRef.current
      ) {
        event.preventDefault();
        event.stopPropagation();
        if (!disabledRef.current) onApplyLink();
      }
    },
    [closeLinkEditor, onApplyLink],
  );

  useEffect(
    () =>
      editor.registerCommand(
        KEY_DOWN_COMMAND,
        (event) => {
          if (
            !disabledRef.current &&
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === "k"
          ) {
            event.preventDefault();
            onLink();
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
    [editor, onLink],
  );

  const onLinkInput: ChangeEventHandler<HTMLInputElement> = useCallback(
    (event) => {
      if (!disabledRef.current) setLinkValue(event.target.value);
    },
    [],
  );

  return {
    closeLinkEditor,
    isLinkEditorOpen,
    linkError,
    linkInputRef,
    linkValue,
    onApplyLink,
    onLink,
    onLinkInput,
    onLinkKeyDown,
    onRemoveLink,
    statusMessage,
  };
};
