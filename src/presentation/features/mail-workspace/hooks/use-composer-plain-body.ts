"use client";

import {
  useCallback,
  type ChangeEventHandler,
  type ClipboardEventHandler,
  type Dispatch,
  type DragEventHandler,
  type SetStateAction,
} from "react";

import {
  COMPOSER_FILE_TRANSFER_MESSAGE,
  composerTransferHasFiles,
  plainTextToComposerHtml,
} from "@/presentation/features/mail-workspace/composer-body-content";
import {
  applyPlainComposerTemplate,
  type ComposerTemplateApplication,
} from "@/presentation/features/mail-workspace/composer-template-editor";

export const useComposerPlainBody = ({
  onContentChange,
  setHtml,
  setPreserveLoadedHtml,
  setStatus,
  setText,
  text,
}: {
  readonly onContentChange: () => void;
  readonly setHtml: Dispatch<SetStateAction<string>>;
  readonly setPreserveLoadedHtml: Dispatch<SetStateAction<boolean>>;
  readonly setStatus: Dispatch<SetStateAction<string>>;
  readonly setText: Dispatch<SetStateAction<string>>;
  readonly text: string;
}) => {
  const onInput: ChangeEventHandler<HTMLTextAreaElement> = useCallback(
    (event) => {
      setText(event.target.value);
      setStatus("");
      onContentChange();
    },
    [onContentChange, setStatus, setText],
  );
  const applyTemplate = useCallback((
    application: ComposerTemplateApplication,
    selectionStart: number,
    selectionEnd: number,
  ) => {
    const result = applyPlainComposerTemplate(
      text,
      application,
      selectionStart,
      selectionEnd,
    );
    setText(result.text);
    setHtml(plainTextToComposerHtml(result.text));
    setPreserveLoadedHtml(false);
    onContentChange();
    return result.caret;
  }, [onContentChange, setHtml, setPreserveLoadedHtml, setText, text]);
  const onPaste: ClipboardEventHandler<HTMLTextAreaElement> = useCallback(
    (event) => {
      if (!composerTransferHasFiles(event.clipboardData)) return;
      event.preventDefault();
      setStatus(COMPOSER_FILE_TRANSFER_MESSAGE);
    },
    [setStatus],
  );
  const onDrop: DragEventHandler<HTMLTextAreaElement> = useCallback(
    (event) => {
      if (!composerTransferHasFiles(event.dataTransfer)) return;
      event.preventDefault();
      setStatus(COMPOSER_FILE_TRANSFER_MESSAGE);
    },
    [setStatus],
  );
  return { applyTemplate, onDrop, onInput, onPaste };
};
