"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import {
  MAX_EMAIL_SIGNATURES,
  type EmailSignature,
} from "@/domain/member/email-signature";
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
import { useEmailSignatureDefaultsModel } from "@/presentation/features/mail-workspace/hooks/use-email-signature-defaults-model";
import { useEmailSignatureDeleteModel } from "@/presentation/features/mail-workspace/hooks/use-email-signature-delete-model";
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
  const [editorVersion, setEditorVersion] = useState(0);
  const [isModeConfirmationOpen, setIsModeConfirmationOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const normalizeRichBridgeRef = useRef<SignatureId | null>(null);
  const defaults = useEmailSignatureDefaultsModel(signatures, setStatus);
  const book = signatures.book;
  const editorDirty = editor
    ? emailSignatureEditorIsDirty(editor, baseline)
    : false;

  const select = useCallback((signature: EmailSignature | null) => {
    normalizeRichBridgeRef.current =
      signature?.htmlBody ? signature.id : null;
    setBaseline(signature);
    setEditor(signature ? emailSignatureEditorDraft(signature) : null);
    setEditorVersion((version) => version + 1);
    setStatus(null);
  }, []);
  const deletion = useEmailSignatureDeleteModel(signatures, select, setStatus);

  useEffect(() => {
    setEditor(null);
    setBaseline(null);
    normalizeRichBridgeRef.current = null;
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
    setEditorVersion((version) => version + 1);
    setIsModeConfirmationOpen(false);
    window.requestAnimationFrame(() =>
      document.getElementById("email-signature-plain-content")?.focus());
  }, []);

  const saveEditor = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
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
        : result.signatures.find(({ id: value }) => !before.has(value)) ?? null;
      select(saved);
      setStatus(saved ? `Signature “${saved.name}” saved.` : "Signature saved.");
    },
    [book?.signatures, editor, select, signatures],
  );

  const cancelMode = useCallback(() => {
    setIsModeConfirmationOpen(false);
    window.requestAnimationFrame(() =>
      document.getElementById("email-signature-mode-plain")?.focus());
  }, []);

  const busy = signatures.isLoading || signatures.isSaving;
  return {
    accountEmail,
    canCreate:
      !busy && !editorDirty && (book?.signatures.length ?? 0) < MAX_EMAIL_SIGNATURES,
    create: () =>
      requireCleanEditor(() => {
        setBaseline(null);
        setEditor(emptyEmailSignatureEditorDraft());
        setEditorVersion((version) => version + 1);
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
            editorDirty && emailSignatureEditorIsValid(editor) && !busy,
          editorVersion,
          htmlBody: editor.htmlBody,
          isNew: editor.signatureId === null,
          mode: editor.mode,
          name: editor.name,
          nameInput: (event) =>
            setEditor({ ...editor, name: event.target.value }),
          onDelete: () => baseline && deletion.request(baseline),
          onDiscard: () => select(baseline),
          onRichChange: (snapshot) => {
            const initial =
              normalizeRichBridgeRef.current === editor.signatureId;
            const next = applyEmailSignatureRichSnapshot(
              editor,
              baseline,
              snapshot,
              initial,
            );
            normalizeRichBridgeRef.current = null;
            setEditor(next.draft);
            if (initial) setBaseline(next.source);
          },
          onSubmit: (event) => void saveEditor(event),
          selectPlainMode: () => {
            if (composerHtmlHasFormatting(editor.htmlBody)) {
              setIsModeConfirmationOpen(true);
            } else {
              switchToPlain();
            }
          },
          selectRichMode: () => {
            normalizeRichBridgeRef.current = null;
            setEditor({
              ...editor,
              htmlBody: plainTextToComposerHtml(editor.body),
              mode: "rich",
              richText: editor.body,
            });
            setEditorVersion((version) => version + 1);
          },
        }
      : null,
    error: signatures.error,
    hasUnsavedChanges: editorDirty || defaults.isDirty,
    isLoading: signatures.isLoading,
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
