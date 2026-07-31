"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
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

export const useComposerBody = (
  isSending: boolean,
  onRichDocumentFlattened: () => void = () => undefined,
  onContentChange: () => void = () => undefined,
) => {
  const [mode, setMode] = useState<ComposerBodyMode>("rich");
  const [text, setText] = useState("");
  const [html, setHtml] = useState("");
  const [editorVersion, setEditorVersion] = useState(0);
  const [isPlainModeWarningOpen, setIsPlainModeWarningOpen] = useState(false);
  const [plainTransferStatus, setPlainTransferStatus] = useState("");
  const [preserveLoadedHtml, setPreserveLoadedHtml] = useState(false);
  const initializedSnapshot = useRef<RichComposerSnapshot | null>(null);
  const loadedProviderSnapshot = useRef<RichComposerSnapshot | null>(null);

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
    setPreserveLoadedHtml(false);
    initializedSnapshot.current = null;
    loadedProviderSnapshot.current = null;
  }, []);

  const loadPlainDraft = useCallback((value: string) => {
    setMode("rich");
    setText(value);
    setHtml(plainTextToComposerHtml(value));
    setEditorVersion((version) => version + 1);
    setIsPlainModeWarningOpen(false);
    setPlainTransferStatus("");
    setPreserveLoadedHtml(false);
    initializedSnapshot.current = null;
    loadedProviderSnapshot.current = null;
  }, []);

  const loadSavedDraft = useCallback(
    (
      value: { readonly body: string; readonly htmlBody?: string },
      trackNormalization = true,
    ) => {
      const nextMode = value.htmlBody === undefined ? "plain" : "rich";
      setMode(nextMode);
      setText(value.body);
      setHtml(value.htmlBody ?? plainTextToComposerHtml(value.body));
      setEditorVersion((version) => version + 1);
      setIsPlainModeWarningOpen(false);
      setPlainTransferStatus("");
      setPreserveLoadedHtml(value.htmlBody !== undefined);
      initializedSnapshot.current = null;
      loadedProviderSnapshot.current =
        !trackNormalization || value.htmlBody === undefined
        ? null
        : { html: value.htmlBody, text: value.body };
    },
    [],
  );

  const onPlainInput: ChangeEventHandler<HTMLTextAreaElement> = useCallback(
    (event) => {
      setText(event.target.value);
      setPlainTransferStatus("");
      onContentChange();
    },
    [onContentChange],
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
    const initialized = initializedSnapshot.current;
    initializedSnapshot.current = null;
    if (initialized?.html === snapshot.html && initialized.text === snapshot.text) {
      return;
    }
    onContentChange();
  }, [onContentChange]);

  const onRichInitialize = useCallback((snapshot: RichComposerSnapshot) => {
    initializedSnapshot.current = snapshot;
    setHtml(snapshot.html);
    setText(snapshot.text);
    const loaded = loadedProviderSnapshot.current;
    loadedProviderSnapshot.current = null;
    if (loaded && (loaded.html !== snapshot.html || loaded.text !== snapshot.text)) {
      onContentChange();
    }
  }, [onContentChange]);

  const switchToPlain = useCallback(() => {
    setMode("plain");
    setPreserveLoadedHtml(false);
    setIsPlainModeWarningOpen(false);
    onRichDocumentFlattened();
    onContentChange();
  }, [onContentChange, onRichDocumentFlattened]);

  const onToggleMode = useCallback(() => {
    if (isSending) return;
    if (mode === "plain") {
      setHtml(plainTextToComposerHtml(text));
      setEditorVersion((version) => version + 1);
      setMode("rich");
      onContentChange();
      return;
    }
    if (composerHtmlHasFormatting(html)) {
      setIsPlainModeWarningOpen(true);
      return;
    }
    switchToPlain();
  }, [html, isSending, mode, onContentChange, switchToPlain, text]);

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
      ...(mode === "rich" &&
        (preserveLoadedHtml || composerHtmlHasFormatting(html))
        ? { htmlBody: html }
        : {}),
    }),
    [html, mode, preserveLoadedHtml, text],
  );

  return {
    cancelPlainMode,
    confirmPlainMode,
    editorVersion,
    html,
    isPlainModeWarningOpen,
    loadPlainDraft,
    loadSavedDraft,
    mode,
    onPlainInput,
    onPlainDrop,
    onPlainPaste,
    onRichChange,
    onRichInitialize,
    onToggleMode,
    onWarningKeyDown,
    payload,
    plainTransferStatus,
    reset,
    text,
  };
};
