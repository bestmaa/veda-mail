"use client";

import { TOGGLE_LINK_COMMAND } from "@lexical/link";
import {
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  $isListNode,
  REMOVE_LIST_COMMAND,
} from "@lexical/list";
import { $setBlocksType } from "@lexical/selection";
import { $createHeadingNode, $isHeadingNode } from "@lexical/rich-text";
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  REDO_COMMAND,
  UNDO_COMMAND,
  mergeRegister,
} from "lexical";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEventHandler,
  type MouseEventHandler,
} from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";

import { nearestComposerLink } from "@/presentation/features/mail-workspace/composer-editor-selection";
import type { ComposerBlockType } from "@/presentation/features/mail-workspace/composer-rich-text.view-model";
import { useComposerEditorLink } from "@/presentation/features/mail-workspace/hooks/use-composer-editor-link";

export const useComposerEditorToolbar = (disabled: boolean) => {
  const [editor] = useLexicalComposerContext();
  const [blockType, setBlockType] = useState<ComposerBlockType>("p");
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);
  const [isLink, setIsLink] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const link = useComposerEditorLink(editor, disabled);

  const updateToolbar = useCallback(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    setIsBold(selection.hasFormat("bold"));
    setIsItalic(selection.hasFormat("italic"));
    setIsUnderline(selection.hasFormat("underline"));
    setIsLink(Boolean(nearestComposerLink(selection.anchor.getNode())));
    const anchor = selection.anchor.getNode();
    const top =
      anchor.getKey() === "root" ? anchor : anchor.getTopLevelElementOrThrow();
    if ($isHeadingNode(top)) {
      setBlockType(top.getTag() === "h2" ? "h2" : "h1");
    } else if ($isListNode(top)) {
      setBlockType(top.getListType() === "number" ? "number" : "bullet");
    } else {
      setBlockType("p");
    }
  }, []);

  useEffect(
    () =>
      mergeRegister(
        editor.registerUpdateListener(({ editorState }) => {
          editorState.read(updateToolbar);
        }),
        editor.registerCommand(
          CAN_UNDO_COMMAND,
          (value) => {
            setCanUndo(value);
            return false;
          },
          COMMAND_PRIORITY_LOW,
        ),
        editor.registerCommand(
          CAN_REDO_COMMAND,
          (value) => {
            setCanRedo(value);
            return false;
          },
          COMMAND_PRIORITY_LOW,
        ),
      ),
    [editor, updateToolbar],
  );

  const formatText = useCallback(
    (format: "bold" | "italic" | "underline") =>
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, format),
    [editor],
  );

  const onBlockTypeChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const value = event.target.value as "h1" | "h2" | "p";
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          $setBlocksType(selection, () =>
            value === "p" ? $createParagraphNode() : $createHeadingNode(value),
          );
        }
      });
    },
    [editor],
  );

  const onClear = useCallback(() => {
    editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      for (const node of selection.getNodes()) {
        if ($isTextNode(node)) node.setFormat(0).setStyle("");
      }
      $setBlocksType(selection, () => $createParagraphNode());
    });
  }, [editor]);

  const onToolbarKeyDown: KeyboardEventHandler<HTMLDivElement> = useCallback(
    (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const controls = Array.from(
        event.currentTarget.querySelectorAll<HTMLElement>(
          "button:not(:disabled),select:not(:disabled)",
        ),
      );
      const current = controls.indexOf(document.activeElement as HTMLElement);
      const next =
        event.key === "Home" ? 0
        : event.key === "End" ? controls.length - 1
        : (current + (event.key === "ArrowRight" ? 1 : -1) + controls.length) %
          controls.length;
      event.preventDefault();
      controls[next]?.focus();
    },
    [],
  );

  const preserveSelection: MouseEventHandler<HTMLElement> = useCallback(
    (event) => event.preventDefault(),
    [],
  );

  return {
    ...link,
    blockType,
    canRedo,
    canUndo,
    isBold,
    isItalic,
    isLink,
    isUnderline,
    onBlockTypeChange,
    onBold: () => formatText("bold"),
    onClear,
    onItalic: () => formatText("italic"),
    onOrderedList: () =>
      editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined),
    onRedo: () => editor.dispatchCommand(REDO_COMMAND, undefined),
    onToolbarKeyDown,
    onUnderline: () => formatText("underline"),
    onUndo: () => editor.dispatchCommand(UNDO_COMMAND, undefined),
    onUnorderedList: () =>
      editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined),
    preserveSelection,
    toolbarRef,
  };
};
