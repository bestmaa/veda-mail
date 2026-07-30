"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEventHandler,
  type ClipboardEventHandler,
  type DragEventHandler,
  type KeyboardEventHandler,
} from "react";

import {
  COMPOSER_FILE_TRANSFER_MESSAGE,
  composerHtmlHasFormatting,
  composerTransferHasFiles,
  plainTextToComposerHtml,
} from "@/presentation/features/mail-workspace/composer-body-content";

export type ComposerBodyMode = "plain" | "rich";

export interface RichComposerSnapshot {
  readonly html: string;
  readonly text: string;
}

export const useComposerBody = (isSending: boolean) => {
  const [mode, setMode] = useState<ComposerBodyMode>("rich");
  const [text, setText] = useState("");
  const [html, setHtml] = useState("");
  const [editorVersion, setEditorVersion] = useState(0);
  const [isPlainModeWarningOpen, setIsPlainModeWarningOpen] = useState(false);
  const [plainTransferStatus, setPlainTransferStatus] = useState("");

  useEffect(() => {
    if (!isPlainModeWarningOpen || isSending) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById("composer-formatting-loss-confirm")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isPlainModeWarningOpen, isSending]);

  const reset = useCallback(() => {
    setMode("rich");
    setText("");
    setHtml("");
    setEditorVersion((version) => version + 1);
    setIsPlainModeWarningOpen(false);
    setPlainTransferStatus("");
  }, []);

  const loadPlainDraft = useCallback((value: string) => {
    setMode("rich");
    setText(value);
    setHtml(plainTextToComposerHtml(value));
    setEditorVersion((version) => version + 1);
    setIsPlainModeWarningOpen(false);
    setPlainTransferStatus("");
  }, []);

  const onPlainInput: ChangeEventHandler<HTMLTextAreaElement> = useCallback(
    (event) => {
      setText(event.target.value);
      setPlainTransferStatus("");
    },
    [],
  );

  const onPlainPaste: ClipboardEventHandler<HTMLTextAreaElement> = useCallback(
    (event) => {
      if (!composerTransferHasFiles(event.clipboardData)) return;
      event.preventDefault();
      setPlainTransferStatus(COMPOSER_FILE_TRANSFER_MESSAGE);
    },
    [],
  );

  const onPlainDrop: DragEventHandler<HTMLTextAreaElement> = useCallback(
    (event) => {
      if (!composerTransferHasFiles(event.dataTransfer)) return;
      event.preventDefault();
      setPlainTransferStatus(COMPOSER_FILE_TRANSFER_MESSAGE);
    },
    [],
  );

  const onRichChange = useCallback((snapshot: RichComposerSnapshot) => {
    setHtml(snapshot.html);
    setText(snapshot.text);
  }, []);

  const switchToPlain = useCallback(() => {
    setMode("plain");
    setIsPlainModeWarningOpen(false);
  }, []);

  const onToggleMode = useCallback(() => {
    if (isSending) return;
    if (mode === "plain") {
      setHtml(plainTextToComposerHtml(text));
      setEditorVersion((version) => version + 1);
      setMode("rich");
      return;
    }
    if (composerHtmlHasFormatting(html)) {
      setIsPlainModeWarningOpen(true);
      return;
    }
    switchToPlain();
  }, [html, isSending, mode, switchToPlain, text]);

  const cancelPlainMode = useCallback(() => {
    if (isSending) return;
    setIsPlainModeWarningOpen(false);
    window.requestAnimationFrame(() => {
      document.getElementById("composer-body-mode-toggle")?.focus();
    });
  }, [isSending]);

  const confirmPlainMode = useCallback(() => {
    if (isSending) return;
    switchToPlain();
    window.requestAnimationFrame(() => {
      document.getElementById("composer-message-body")?.focus();
    });
  }, [isSending, switchToPlain]);

  const onWarningKeyDown: KeyboardEventHandler<HTMLDivElement> = useCallback(
    (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cancelPlainMode();
    },
    [cancelPlainMode],
  );

  const payload = useMemo(
    () => ({
      body: text,
      ...(mode === "rich" && composerHtmlHasFormatting(html)
        ? { htmlBody: html }
        : {}),
    }),
    [html, mode, text],
  );

  return {
    cancelPlainMode,
    confirmPlainMode,
    editorVersion,
    html,
    isPlainModeWarningOpen,
    loadPlainDraft,
    mode,
    onPlainInput,
    onPlainDrop,
    onPlainPaste,
    onRichChange,
    onToggleMode,
    onWarningKeyDown,
    payload,
    plainTransferStatus,
    reset,
    text,
  };
};
