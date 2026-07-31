"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { MAX_EMAIL_SIGNATURES, type EmailSignature } from "@/domain/member/email-signature";
import type { SignatureId } from "@/domain/shared/brand";
import {
  applyEmailSignatureRichSnapshot,
  emailSignatureEditorContent,
  emailSignatureEditorDraft,
  emailSignatureEditorIsDirty,
  emailSignatureEditorIsValid,
  emptyEmailSignatureEditorDraft,
  type EmailSignatureEditorDraft,
} from "@/presentation/features/mail-workspace/email-signature-editor-state";
import type { EmailSignatureSettingsViewModel } from "@/presentation/features/mail-workspace/email-signature-settings.view-model";
import {
  composerHtmlHasFormatting,
  plainTextToComposerHtml,
} from "@/presentation/features/mail-workspace/composer-body-content";
import type { EmailSignaturesModel } from "@/presentation/features/mail-workspace/hooks/use-email-signatures-model";
import type { RichComposerSnapshot } from "@/presentation/features/mail-workspace/hooks/use-composer-body";
import { useEmailSignatureDefaultsModel } from "@/presentation/features/mail-workspace/hooks/use-email-signature-defaults-model";
import { useEmailSignatureDeleteModel } from "@/presentation/features/mail-workspace/hooks/use-email-signature-delete-model";
import { useEmailSignatureRichInitialization } from "@/presentation/features/mail-workspace/hooks/use-email-signature-rich-initialization";
const signatureById = (
  signatures: readonly EmailSignature[],
  signatureId: SignatureId | null,
) => signatures.find(({ id: candidate }) => candidate === signatureId) ?? null;

export const useEmailSignatureSettingsModel = (
  accountEmail: string,
  signatures: EmailSignaturesModel,
  accountScopeKey: string = accountEmail,
): EmailSignatureSettingsViewModel => {
  const [editor, setEditor] = useState<EmailSignatureEditorDraft | null>(null);
  const [baseline, setBaseline] = useState<EmailSignature | null>(null);
  const [isModeConfirmationOpen, setIsModeConfirmationOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const {
    consume: consumeRichInitialization,
    remount: remountRichEditor,
    version: editorVersion,
  } = useEmailSignatureRichInitialization();
  const defaults = useEmailSignatureDefaultsModel(signatures, setStatus);
  const book = signatures.book;
  const editorDirty = editor ? emailSignatureEditorIsDirty(editor, baseline) : false;

  const select = useCallback((signature: EmailSignature | null) => {
    setBaseline(signature);
    setEditor(signature ? emailSignatureEditorDraft(signature) : null);
    remountRichEditor(signature);
    setStatus(null);
  }, [remountRichEditor]);
  const deletion = useEmailSignatureDeleteModel(signatures, select, setStatus);

  useEffect(() => {
    setEditor(null);
    setBaseline(null);
    deletion.reset();
    setIsModeConfirmationOpen(false);
    setStatus(null);
  }, [accountScopeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!book) return;
    if (editorDirty || editor?.signatureId === null) return;
    const selected = signatureById(
      book.signatures,
      editor?.signatureId ?? null,
    );
    select(selected ?? book.signatures[0] ?? null);
  }, [book?.revision]); // eslint-disable-line react-hooks/exhaustive-deps

  const requireCleanEditor = useCallback(
    (task: () => void) => {
      if (editorDirty) {
        setStatus("Save or discard your signature changes first.");
        return;
      }
      task();
    },
    [editorDirty],
  );

  const switchToPlain = useCallback(() => {
    setEditor((current) =>
      current
        ? {
            ...current,
            body: current.richText,
            htmlBody: "",
            mode: "plain",
          }
        : current,
    );
    remountRichEditor(null);
    setIsModeConfirmationOpen(false);
    window.requestAnimationFrame(() =>
      document.getElementById("email-signature-plain-content")?.focus(),
    );
  }, [remountRichEditor]);

  const saveEditor = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!book) {
        setStatus("Reload signatures before saving changes.");
        return;
      }
      if (!editor || !emailSignatureEditorIsValid(editor)) {
        setStatus("Add a name and non-blank signature content.");
        return;
      }
      const before = new Set(book?.signatures.map(({ id: value }) => value));
      const content = emailSignatureEditorContent(editor);
      const result = await signatures.mutate(
        editor.signatureId
          ? {
              content,
              name: editor.name,
              operation: "update",
              signatureId: editor.signatureId,
            }
          : { content, name: editor.name, operation: "create" },
      );
      if (!result) return;
      const saved = editor.signatureId
        ? signatureById(result.signatures, editor.signatureId)
        : (result.signatures.find(({ id: value }) => !before.has(value)) ??
          null);
      select(saved);
      setStatus(
        saved ? `Signature “${saved.name}” saved.` : "Signature saved.",
      );
    },
    [book, editor, select, signatures],
  );

  const cancelMode = useCallback(() => {
    setIsModeConfirmationOpen(false);
    window.requestAnimationFrame(() =>
      document.getElementById("email-signature-mode-plain")?.focus(),
    );
  }, []);
  const busy = signatures.isLoading || signatures.isSaving;
  const canMutate = Boolean(book) && !busy;
  const updateRich = (
    snapshot: RichComposerSnapshot,
    initialize: boolean,
  ): void => {
    if (!editor) return;
    const next = applyEmailSignatureRichSnapshot(
      editor,
      baseline,
      snapshot,
      initialize,
    );
    setEditor(next.draft);
    if (initialize) setBaseline(next.source);
  };
  return {
    accountEmail,
    canCreate:
      canMutate &&
      !editorDirty &&
      (book?.signatures.length ?? 0) < MAX_EMAIL_SIGNATURES,
    create: () =>
      requireCleanEditor(() => {
        setBaseline(null);
        setEditor(emptyEmailSignatureEditorDraft());
        remountRichEditor(null);
      }),
    defaults,
    deleteConfirmation: deletion.confirmation,
    discardAll: () => {
      defaults.onDiscard();
      const selected = signatureById(
        book?.signatures ?? [],
        editor?.signatureId ?? null,
      );
      select(selected ?? book?.signatures[0] ?? null);
      deletion.reset();
      setIsModeConfirmationOpen(false);
    },
    editor: editor
      ? {
          body: editor.body,
          bodyInput: (event) =>
            setEditor({ ...editor, body: event.target.value }),
          canDelete: Boolean(editor.signatureId) && !busy,
          canDiscard: editorDirty && !busy,
          canSave:
            canMutate && editorDirty && emailSignatureEditorIsValid(editor),
          editorVersion,
          htmlBody: editor.htmlBody,
          isNew: editor.signatureId === null,
          mode: editor.mode,
          name: editor.name,
          nameInput: (event) =>
            setEditor({ ...editor, name: event.target.value }),
          onDelete: () => baseline && deletion.request(baseline),
          onDiscard: () => select(baseline),
          onRichChange: (snapshot) => updateRich(snapshot, false),
          onRichInitialize: (snapshot) =>
            updateRich(snapshot, consumeRichInitialization(editor, baseline)),
          onSubmit: (event) => void saveEditor(event),
          selectPlainMode: () => {
            if (composerHtmlHasFormatting(editor.htmlBody)) {
              setIsModeConfirmationOpen(true);
            } else {
              switchToPlain();
            }
          },
          selectRichMode: () => {
            setEditor({
              ...editor,
              htmlBody: plainTextToComposerHtml(editor.body),
              mode: "rich",
              richText: editor.body,
            });
            remountRichEditor(null);
          },
        }
      : null,
    error: signatures.error,
    hasUnsavedChanges: editorDirty || defaults.isDirty,
    isLoading: signatures.isLoading,
    isReady: Boolean(book),
    isSaving: signatures.isSaving,
    items: (book?.signatures ?? []).map((signature) => ({
      id: signature.id,
      isSelected: editor?.signatureId === signature.id,
      name: signature.name,
      onSelect: () => requireCleanEditor(() => select(signature)),
    })),
    maximumSignatures: MAX_EMAIL_SIGNATURES,
    modeConfirmation: {
      description:
        "Switching this signature to plain text removes headings, lists, links, and text styling.",
      isOpen: isModeConfirmationOpen,
      onCancel: cancelMode,
      onConfirm: switchToPlain,
      title: "Remove signature formatting?",
    },
    retry: signatures.retry,
    status,
  };
};
