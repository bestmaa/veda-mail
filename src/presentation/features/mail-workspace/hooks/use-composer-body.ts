"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEventHandler,
} from "react";

import {
  composerHtmlHasFormatting,
  plainTextToComposerHtml,
} from "@/presentation/features/mail-workspace/composer-body-content";
import type { ComposerRecoveryBody } from "@/presentation/features/mail-workspace/composer-recovery.types";
import { useComposerPlainBody } from "@/presentation/features/mail-workspace/hooks/use-composer-plain-body";

export type ComposerBodyMode = "plain" | "rich";

export interface RichComposerSnapshot {
  readonly html: string;
  readonly templateHtml?: string;
  readonly templateText?: string;
  readonly text: string;
}

export const useComposerBody = (
  isSending: boolean,
  onRichDocumentFlattened: () => void = () => undefined,
  onContentChange: () => void = () => undefined,
  onProgrammaticChange: () => void = onContentChange,
) => {
  const [mode, setMode] = useState<ComposerBodyMode>("rich");
  const [text, setText] = useState("");
  const [html, setHtml] = useState("");
  const [templateHtml, setTemplateHtml] = useState("");
  const [templateText, setTemplateText] = useState("");
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
    setTemplateHtml("");
    setTemplateText("");
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
    setTemplateHtml(plainTextToComposerHtml(value));
    setTemplateText(value);
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
      setTemplateHtml(value.htmlBody ?? plainTextToComposerHtml(value.body));
      setTemplateText(value.body);
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

  const restoreRecovery = useCallback((value: ComposerRecoveryBody) => {
    setMode(value.mode);
    setText(value.text);
    setHtml(value.mode === "rich" ? value.html : plainTextToComposerHtml(value.text));
    setTemplateHtml(value.mode === "rich" ? value.html : plainTextToComposerHtml(value.text));
    setTemplateText(value.text);
    setEditorVersion((version) => version + 1);
    setIsPlainModeWarningOpen(false);
    setPlainTransferStatus("");
    setPreserveLoadedHtml(
      value.mode === "rich" && value.preserveLoadedHtml,
    );
    initializedSnapshot.current = null;
    loadedProviderSnapshot.current = null;
  }, []);

  const plain = useComposerPlainBody({
    onContentChange,
    setHtml,
    setPreserveLoadedHtml,
    setStatus: setPlainTransferStatus,
    setText,
    text,
  });

  const onRichChange = useCallback((snapshot: RichComposerSnapshot) => {
    setHtml(snapshot.html);
    setTemplateHtml(snapshot.templateHtml ?? snapshot.html);
    setTemplateText(snapshot.templateText ?? snapshot.text);
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
    setTemplateHtml(snapshot.templateHtml ?? snapshot.html);
    setTemplateText(snapshot.templateText ?? snapshot.text);
    setText(snapshot.text);
    const loaded = loadedProviderSnapshot.current;
    loadedProviderSnapshot.current = null;
    if (loaded && (loaded.html !== snapshot.html || loaded.text !== snapshot.text)) {
      onProgrammaticChange();
    }
  }, [onProgrammaticChange]);

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
    applyPlainTemplate: plain.applyTemplate,
    cancelPlainMode,
    confirmPlainMode,
    editorVersion,
    html,
    isPlainModeWarningOpen,
    loadPlainDraft,
    loadSavedDraft,
    mode,
    onPlainInput: plain.onInput,
    onPlainDrop: plain.onDrop,
    onPlainPaste: plain.onPaste,
    onRichChange,
    onRichInitialize,
    onToggleMode,
    onWarningKeyDown,
    payload,
    plainTransferStatus,
    reset,
    restoreRecovery,
    text,
    templateHtml,
    templateText,
    recoveryBody: mode === "plain"
      ? { mode, text }
      : { html, mode, preserveLoadedHtml, text },
  };
};
