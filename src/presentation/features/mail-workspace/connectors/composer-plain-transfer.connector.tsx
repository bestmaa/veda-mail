"use client";

import { $handlePlainTextDrop } from "@lexical/clipboard";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  COMPOSER_FILE_TRANSFER_MESSAGE,
  COMPOSER_RICH_TRANSFER_LINE_LIMIT_MESSAGE,
  composerTransferExceedsRichLineLimit,
  composerTransferHasFiles,
  normalizeComposerTransferText,
} from "@/presentation/features/mail-workspace/composer-body-content";
import {
  $createLineBreakNode,
  $createRangeSelection,
  $getNearestNodeFromDOMNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  $normalizeSelection__EXPERIMENTAL,
  $setSelection,
  COMMAND_PRIORITY_HIGH,
  DROP_COMMAND,
  PASTE_COMMAND,
  mergeRegister,
} from "lexical";
import { useEffect, useState } from "react";

const LEXICAL_DRAG_MIME_TYPE = "application/x-lexical-drag";

const normalizeTextLineBreaks = (): void => {
  for (const node of $getRoot().getAllTextNodes()) {
    let remainder = node;
    while (remainder.isAttached()) {
      const text = remainder.getTextContent();
      const lineBreakIndex = text.indexOf("\n");
      if (lineBreakIndex < 0) break;
      if (text.length === 1) {
        remainder.replace($createLineBreakNode());
        break;
      }
      if (lineBreakIndex === 0) {
        const [lineBreak, next] = remainder.splitText(1);
        if (!lineBreak || !next) break;
        lineBreak.replace($createLineBreakNode());
        remainder = next;
      } else if (lineBreakIndex === text.length - 1) {
        const [, lineBreak] = remainder.splitText(lineBreakIndex);
        if (!lineBreak) break;
        lineBreak.replace($createLineBreakNode());
        break;
      } else {
        const [, lineBreak, next] = remainder.splitText(
          lineBreakIndex,
          lineBreakIndex + 1,
        );
        if (!lineBreak || !next) break;
        lineBreak.replace($createLineBreakNode());
        remainder = next;
      }
    }
  }
};

const insertPlainText = (
  selection: ReturnType<typeof $createRangeSelection>,
  value: string,
): void => {
  selection.insertRawText(value);
  normalizeTextLineBreaks();
};

const selectionAtDropPoint = (
  event: DragEvent,
): ReturnType<typeof $createRangeSelection> | null => {
  const range = document.caretRangeFromPoint?.(event.clientX, event.clientY);
  const position = range
    ? { node: range.startContainer, offset: range.startOffset }
    : document.caretPositionFromPoint?.(event.clientX, event.clientY);
  if (!position) return null;

  const node = $getNearestNodeFromDOMNode(
    "node" in position ? position.node : position.offsetNode,
  );
  if (!node) return null;

  const selection = $createRangeSelection();
  if ($isTextNode(node)) {
    const offset = Math.min(position.offset, node.getTextContentSize());
    selection.anchor.set(node.getKey(), offset, "text");
    selection.focus.set(node.getKey(), offset, "text");
  } else if ($isElementNode(node)) {
    const offset = Math.min(position.offset, node.getChildrenSize());
    selection.anchor.set(node.getKey(), offset, "element");
    selection.focus.set(node.getKey(), offset, "element");
  } else {
    const parent = node.getParent();
    if (!parent) return null;
    const offset = node.getIndexWithinParent() + 1;
    selection.anchor.set(parent.getKey(), offset, "element");
    selection.focus.set(parent.getKey(), offset, "element");
  }
  return $normalizeSelection__EXPERIMENTAL(selection);
};

export const ComposerPlainTransferConnector = () => {
  const [editor] = useLexicalComposerContext();
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(
    () =>
      mergeRegister(
        editor.registerCommand(
          PASTE_COMMAND,
          (event) => {
            const clipboard =
              "clipboardData" in event ? event.clipboardData : null;
            if (!clipboard) return false;
            event.preventDefault();
            if (composerTransferHasFiles(clipboard)) {
              setStatusMessage(COMPOSER_FILE_TRANSFER_MESSAGE);
              return true;
            }
            const text = normalizeComposerTransferText(
              clipboard.getData("text/plain"),
            );
            if (composerTransferExceedsRichLineLimit(text)) {
              setStatusMessage(COMPOSER_RICH_TRANSFER_LINE_LIMIT_MESSAGE);
              return true;
            }
            const selection = $getSelection();
            if ($isRangeSelection(selection)) {
              insertPlainText(selection, text);
            }
            return true;
          },
          COMMAND_PRIORITY_HIGH,
        ),
        editor.registerCommand(
          DROP_COMMAND,
          (event) => {
            const transfer = event.dataTransfer;
            if (!transfer || composerTransferHasFiles(transfer)) {
              event.preventDefault();
              setStatusMessage(COMPOSER_FILE_TRANSFER_MESSAGE);
              return true;
            }
            const text = normalizeComposerTransferText(
              transfer.getData("text/plain"),
            );
            if (composerTransferExceedsRichLineLimit(text)) {
              event.preventDefault();
              setStatusMessage(COMPOSER_RICH_TRANSFER_LINE_LIMIT_MESSAGE);
              return true;
            }
            if (Array.from(transfer.types).includes(LEXICAL_DRAG_MIME_TYPE)) {
              if ($handlePlainTextDrop(event, editor)) {
                normalizeTextLineBreaks();
                return true;
              }
              event.preventDefault();
              return true;
            }
            event.preventDefault();
            const selection = selectionAtDropPoint(event);
            if (!selection) return true;
            $setSelection(selection);
            insertPlainText(selection, text);
            return true;
          },
          COMMAND_PRIORITY_HIGH,
        ),
      ),
    [editor],
  );

  return (
    <span aria-live="polite" className="sr-only" role="status">
      {statusMessage}
    </span>
  );
};
