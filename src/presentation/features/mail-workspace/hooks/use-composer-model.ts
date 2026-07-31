"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { createForwardDraft, createReplyAllDraft, createReplyDraft, parseRecipientInputs } from "@/domain/mail/compose";
import type { DraftContent, DraftDetail } from "@/domain/mail/draft";
import type { ComposeInput, MessageDetail, SendReceipt } from "@/domain/mail/mail";
import type { EmailSignatureBook } from "@/domain/member/email-signature";
import { id } from "@/domain/shared/brand";
import { useComposerAttachments } from "@/presentation/features/mail-workspace/hooks/use-composer-attachments";
import { useComposerBody } from "@/presentation/features/mail-workspace/hooks/use-composer-body";
import { useComposerDraft } from "@/presentation/features/mail-workspace/hooks/use-composer-draft";
import { useComposerFields, type ComposerTitle } from "@/presentation/features/mail-workspace/hooks/use-composer-fields";
import { useComposerFocusTrap, useComposerReturnFocus } from "@/presentation/features/mail-workspace/hooks/use-composer-focus";
import { useComposerSubmit } from "@/presentation/features/mail-workspace/hooks/use-composer-submit";
import { useComposerSignatures } from "@/presentation/features/mail-workspace/hooks/use-composer-signatures";
import { ignoreMailSessionFailure, type MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";

const focusById = (elementId: string) => {
  if (typeof window === "undefined") return;
  window.requestAnimationFrame(() => document.getElementById(elementId)?.focus());
};
const hasDefaultSignature = (
  book: EmailSignatureBook | null,
  context: "newMessageId" | "replyForwardId",
) => Boolean(book?.signatures.some(({ id: signatureId }) =>
  signatureId === book.defaults[context]));

export const useComposerModel = (
  onSent: (receipt: SendReceipt, submittedEmails: readonly string[]) => void,
  maxAttachmentBytes: number | null,
  signatureBook: EmailSignatureBook | null = null,
  accountKey = "",
  isComposerReady = true,
  initialAttachmentSessionScope = "",
  handleSessionFailure: MailSessionFailureHandler = ignoreMailSessionFailure,
  draftsEnabled = false,
  onDraftChanged: () => void = () => undefined,
) => {
  const [isOpen, setIsOpen] = useState(false);
  const [openAccountKey, setOpenAccountKey] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const accountKeyRef = useRef(accountKey);
  const markUnsavedRef = useRef<() => void>(() => undefined);
  const markUnsaved = useCallback(() => markUnsavedRef.current(), []);
  useLayoutEffect(() => { accountKeyRef.current = accountKey; }, [accountKey]);

  const attachments = useComposerAttachments(
    maxAttachmentBytes,
    accountKey,
    initialAttachmentSessionScope,
    handleSessionFailure,
  );
  const signatures = useComposerSignatures(signatureBook);
  const fields = useComposerFields(markUnsaved);
  const body = useComposerBody(isSending, signatures.detach, markUnsaved);
  const draftContent = useMemo<DraftContent>(() => ({
    ...parseRecipientInputs({ bcc: fields.bcc, cc: fields.cc, to: fields.to }),
    ...body.payload,
    ...(fields.inReplyTo ? { inReplyTo: fields.inReplyTo } : {}),
    subject: fields.subject,
  }), [body.payload, fields.bcc, fields.cc, fields.inReplyTo, fields.subject, fields.to]);

  const hydrateSavedDraft = useCallback((savedDraft: DraftDetail) => {
    fields.hydrate(savedDraft.content, "Edit draft");
    body.loadSavedDraft(
      savedDraft.content,
      !savedDraft.hasUncertainSubmission &&
        !savedDraft.hasAttachments && !savedDraft.hasTruncatedContent,
    );
    signatures.reset();
    if (savedDraft.composeId) attachments.adoptDraftId(savedDraft.composeId);
    setError(null);
  }, [attachments, body, fields, signatures]);
  const draft = useComposerDraft({
    accountKey,
    composeId: attachments.draftId,
    content: draftContent,
    enabled: draftsEnabled,
    handleSessionFailure,
    hasLocalAttachments: attachments.attachments.length > 0,
    onDiscarded: onDraftChanged,
    onHydrate: hydrateSavedDraft,
    onSaved: onDraftChanged,
  });
  useLayoutEffect(() => { markUnsavedRef.current = draft.markUnsaved; }, [draft.markUnsaved]);

  const returnFocus = useComposerReturnFocus();
  const resetEditor = useCallback(() => {
    fields.reset();
    body.reset();
    signatures.reset();
    setOpenAccountKey("");
    setConfirmClose(false);
    setConfirmDiscard(false);
    setError(null);
  }, [body, fields, signatures]);
  const beginOpen = useCallback((title: ComposerTitle) => {
    if (!accountKey || !isComposerReady) return null;
    returnFocus.remember();
    draft.reset();
    resetEditor();
    fields.setTitle(title);
    const composeId = attachments.discard(true);
    void attachments.refreshCapability();
    setOpenAccountKey(accountKey);
    setIsOpen(true);
    return composeId;
  }, [accountKey, attachments, draft, fields, isComposerReady, resetEditor, returnFocus]);
  const open = useCallback(() => {
    if (!beginOpen("New message")) return;
    signatures.prepare("new");
    if (hasDefaultSignature(signatureBook, "newMessageId")) draft.markUnsaved();
  }, [beginOpen, draft, signatureBook, signatures]);
  const openPrepared = useCallback((input: ComposeInput, title: ComposerTitle) => {
    const composeId = beginOpen(title);
    if (!composeId) return null;
    fields.hydrate(input, title);
    body.loadPlainDraft(input.body);
    signatures.prepare("reply-forward");
    draft.markUnsaved();
    return composeId;
  }, [beginOpen, body, draft, fields, signatures]);
  const openReply = useCallback((message: MessageDetail | null) =>
    message && openPrepared(createReplyDraft(message), "Reply"), [openPrepared]);
  const openReplyAll = useCallback((message: MessageDetail | null, email: string) =>
    message && openPrepared(createReplyAllDraft(message, email), "Reply all"), [openPrepared]);
  const openForward = useCallback((message: MessageDetail | null) => {
    if (!message) return;
    const composeId = openPrepared(createForwardDraft(message), "Forward message");
    if (composeId) attachments.importOriginalAttachments(message, composeId);
  }, [attachments, openPrepared]);
  const openSavedDraft = useCallback((providerDraftId: string) => {
    if (!beginOpen("Edit draft")) return;
    void draft.load(id.providerDraft(providerDraftId));
  }, [beginOpen, draft]);

  const finishClose = useCallback(() => {
    setIsOpen(false);
    draft.reset();
    resetEditor();
    attachments.discard(true);
    returnFocus.restore();
  }, [attachments, draft, resetEditor, returnFocus]);
  const requestClose = useCallback(() => {
    if (isSending || draft.isDiscarding || draft.isLoading || draft.phase === "saving") return;
    if (attachments.attachments.some((item) =>
      item.source && item.state === "uploading")) {
      finishClose();
      return;
    }
    if (confirmDiscard) {
      setConfirmDiscard(false);
      focusById("composer-discard");
    } else if (confirmClose) {
      setConfirmClose(false);
      focusById("composer-close");
    } else if (draft.hasUnsavedChanges) {
      setConfirmClose(true);
      focusById("composer-close-without-saving");
    } else finishClose();
  }, [attachments.attachments, confirmClose, confirmDiscard, draft,
    finishClose, isSending]);
  const discard = useCallback(async () => {
    if (await draft.discard()) finishClose();
  }, [draft, finishClose]);
  const requestDiscard = useCallback(() => {
    if (!draft.canDiscard || isSending || draft.isDiscarding || draft.isLoading || draft.phase === "saving") return;
    if (!draft.requiresDiscardConfirmation) {
      void discard();
      return;
    }
    setConfirmDiscard(true);
    focusById("composer-discard-confirm");
  }, [discard, draft, isSending]);
  const cancelClose = useCallback(() => {
    setConfirmClose(false);
    focusById("composer-close");
  }, []);
  const cancelDiscard = useCallback(() => {
    setConfirmDiscard(false);
    focusById("composer-discard");
  }, []);
  const isOpenForAccount = isOpen && openAccountKey === accountKey;
  useEffect(() => {
    if (!isOpen || openAccountKey === accountKey) return;
    setIsOpen(false);
    setIsSending(false);
    draft.reset();
    attachments.discard(true);
    resetEditor();
  }, [accountKey, attachments, draft, isOpen, openAccountKey, resetEditor]);
  const isBusy = isSending || draft.isDiscarding || draft.isLoading || draft.phase === "saving";
  useComposerFocusTrap(isOpenForAccount, isBusy, requestClose);

  const onSubmit = useComposerSubmit({
    attachments, body, fields, handleSessionFailure,
    draftSendBlockedMessage: draft.sendBlockedMessage,
    isAccountCurrent: (key) => accountKeyRef.current === key,
    isDraftBusy: draft.isDiscarding || draft.isLoading || draft.phase === "saving",
    isDraftReadOnly: !draft.canEdit,
    onDraftSent: () => { draft.markSent(); onDraftChanged(); },
    onSent, openAccountKey, providerDraft: draft.providerDraft,
    resetFields: resetEditor, restoreFocus: returnFocus.restore,
    setError, setIsOpen, setIsSending,
  });

  return {
    ...fields, attachmentCapabilityUnavailable: attachments.capabilityUnavailable,
    attachments: attachments.attachments, body, close: requestClose,
    closeConfirmationOpen: confirmClose, discardConfirmationOpen: confirmDiscard,
    draft, error, isAttachmentCapabilityRefreshing: attachments.isCapabilityRefreshing,
    isBusy, isOpen: isOpenForAccount, isSending, isUploading: attachments.isUploading,
    maxAttachmentBytes: attachments.maxFileBytes,
    onAttachmentInput: attachments.onFiles, onCancelClose: cancelClose,
    onCancelDiscard: cancelDiscard, onConfirmClose: finishClose,
    onConfirmDiscard: discard, onRequestDiscard: requestDiscard,
    onRetryAttachmentCapability: attachments.refreshCapability,
    onSubmit, open, openForward, openReply, openReplyAll, openSavedDraft,
    removeAttachment: attachments.remove, retryAttachment: attachments.retry, signatures,
  };
};
