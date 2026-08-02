"use client";

import { useEffect, useRef, type ChangeEventHandler, type ClipboardEventHandler, type DragEventHandler } from "react";

import type { ComposerTemplateApplication } from "@/presentation/features/mail-workspace/composer-template-editor";

export const ComposerPlainBodyConnector = ({
  application,
  autoFocus,
  disabled,
  onApplyTemplate,
  onChange,
  onDrop,
  onPaste,
  onTemplateApplied,
  placeholder = "Write a clear message…",
  readOnly,
  value,
}: {
  readonly application: ComposerTemplateApplication | null;
  readonly autoFocus: boolean;
  readonly disabled: boolean;
  readonly onApplyTemplate: (
    application: ComposerTemplateApplication,
    selectionStart: number,
    selectionEnd: number,
  ) => number;
  readonly onChange: ChangeEventHandler<HTMLTextAreaElement>;
  readonly onDrop: DragEventHandler<HTMLTextAreaElement>;
  readonly onPaste: ClipboardEventHandler<HTMLTextAreaElement>;
  readonly onTemplateApplied: (nonce: number) => void;
  readonly placeholder?: string;
  readonly readOnly: boolean;
  readonly value: string;
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const appliedNonce = useRef<number | null>(null);
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!application || !textarea || disabled || readOnly ||
        appliedNonce.current === application.nonce) return;
    appliedNonce.current = application.nonce;
    const caret = onApplyTemplate(
      application,
      textarea.selectionStart,
      textarea.selectionEnd,
    );
    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(caret, caret);
      onTemplateApplied(application.nonce);
    });
  }, [application, disabled, onApplyTemplate, onTemplateApplied, readOnly]);
  return (
    <textarea
      aria-label="Message body"
      autoFocus={autoFocus}
      className="min-h-0 flex-1 resize-none px-4 py-4 text-sm leading-6 text-slate-700 outline-none placeholder:text-slate-500 focus-visible:outline-2 focus-visible:outline-indigo-600"
      disabled={disabled}
      id="composer-message-body"
      onChange={onChange}
      onDrop={onDrop}
      onPaste={onPaste}
      placeholder={placeholder}
      readOnly={readOnly}
      ref={textareaRef}
      required
      value={value}
    />
  );
};
