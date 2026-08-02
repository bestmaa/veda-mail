"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createForwardDraft, createReplyAllDraft, createReplyDraft, parseRecipientInputs } from "@/domain/mail/compose";
import type { DraftContent, DraftDetail } from "@/domain/mail/draft";
import type { ComposeInput, MessageDetail, SendReceipt } from "@/domain/mail/mail";
import type { EmailSignatureBook } from "@/domain/member/email-signature";
import { id } from "@/domain/shared/brand";
import type { ComposerRecoveryOwner } from "@/presentation/features/mail-workspace/composer-recovery.types";
import { useComposerAttachments } from "@/presentation/features/mail-workspace/hooks/use-composer-attachments";
import { useComposerBody } from "@/presentation/features/mail-workspace/hooks/use-composer-body";
import { useComposerClose } from "@/presentation/features/mail-workspace/hooks/use-composer-close";
import { useComposerDraft } from "@/presentation/features/mail-workspace/hooks/use-composer-draft";
import { useComposerFields, type ComposerTitle } from "@/presentation/features/mail-workspace/hooks/use-composer-fields";
import { useComposerFocusTrap, useComposerReturnFocus } from "@/presentation/features/mail-workspace/hooks/use-composer-focus";
import { useComposerRecovery } from "@/presentation/features/mail-workspace/hooks/use-composer-recovery";
import { useComposerRecoveryFlow } from "@/presentation/features/mail-workspace/hooks/use-composer-recovery-flow";
import { useComposerSchedule } from "@/presentation/features/mail-workspace/hooks/use-composer-schedule";
import { useComposerSubmit } from "@/presentation/features/mail-workspace/hooks/use-composer-submit";
import { useComposerSignatures } from "@/presentation/features/mail-workspace/hooks/use-composer-signatures";
import { useComposerTemplates } from "@/presentation/features/mail-workspace/hooks/use-composer-templates";
import type { EmailTemplatesModel } from "@/presentation/features/mail-workspace/hooks/use-email-templates-model";
import { ignoreMailSessionFailure, type MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
const hasDefaultSignature = (
  book: EmailSignatureBook | null,
  context: "newMessageId" | "replyForwardId",
) => Boolean(book?.signatures.some(({ id: signatureId }) =>
  signatureId === book.defaults[context]));
const emptyTemplates: EmailTemplatesModel = {
  book: null, clearError: () => undefined, error: null,
  hasSessionChanged: false, isLoading: false, isSaving: false,
  mutate: async () => null, phase: "idle", retry: () => undefined,
};
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
  recoveryOwner: ComposerRecoveryOwner | null = null,
  emailTemplates: EmailTemplatesModel = emptyTemplates,
  scheduledSendEnabled = true,
) => {
  const [isOpen, setIsOpen] = useState(false);
  const [openAccountKey, setOpenAccountKey] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const accountKeyRef = useRef(accountKey);
  const markUnsavedRef = useRef<() => void>(() => undefined);
  const markProgrammaticRef = useRef<() => void>(() => undefined);
  const markUnsaved = useCallback(() => markUnsavedRef.current(), []);
  const markProgrammatic = useCallback(() => markProgrammaticRef.current(), []);
  useLayoutEffect(() => { accountKeyRef.current = accountKey; }, [accountKey]);
  const attachments = useComposerAttachments(
    maxAttachmentBytes,
    accountKey,
    initialAttachmentSessionScope,
    handleSessionFailure,
    markUnsaved,
  );
  const signatures = useComposerSignatures(signatureBook);
  const fields = useComposerFields(markUnsaved);
  const body = useComposerBody(
    isSending, signatures.detach, markUnsaved, markProgrammatic,
  );
  const templates = useComposerTemplates({
    body, disabled: isSending, fields, templates: emailTemplates,
  });
  const resetTemplates = templates.reset;
  const recovery = useComposerRecovery(
    recoveryOwner, fields, body, signatures, attachments,
  );
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
        !savedDraft.hasTruncatedContent,
    );
    signatures.reset();
    resetTemplates();
    attachments.adoptProviderDraft(savedDraft);
    setError(null);
  }, [attachments, body, fields, resetTemplates, signatures]);
  const draft = useComposerDraft({
    accountKey,
    attachmentIds: attachments.attachmentIds,
    composeId: attachments.draftId,
    content: draftContent,
    enabled: draftsEnabled,
    handleSessionFailure,
    hasLocalAttachments: attachments.attachmentIds.length > 0,
    onDiscarded: onDraftChanged,
    onHydrate: hydrateSavedDraft,
    onSaved: (savedDraft, attempt) => {
      attachments.reconcileProviderDraft(
        savedDraft,
        attempt.attachmentIds ?? [],
        attempt.retainedAttachmentIds ?? [],
      );
      onDraftChanged();
    },
    retainedAttachmentIds: attachments.providerAttachmentIds,
    recovery: recovery.journal.port,
    recoverySnapshot: recovery.hydration.snapshot,
  });
  useLayoutEffect(() => { markUnsavedRef.current = draft.markUnsaved; }, [draft.markUnsaved]);
  useLayoutEffect(() => {
    markProgrammaticRef.current = draft.markProgrammaticChange;
  }, [draft.markProgrammaticChange]);
  const returnFocus = useComposerReturnFocus();
  const resetEditor = useCallback(() => {
    fields.reset();
    body.reset();
    signatures.reset();
    resetTemplates();
    setOpenAccountKey("");
    setConfirmClose(false);
    setConfirmDiscard(false);
    setError(null);
  }, [body, fields, resetTemplates, signatures]);
  const close = useComposerClose({
    accountKeyRef, attachments, confirmClose, confirmDiscard, draft, isSending,
    openAccountKey, resetEditor, returnFocus, setConfirmClose,
    setConfirmDiscard, setError, setIsOpen,
  });
  const onScheduled = useCallback(async () => {
    await draft.clearRecovery().catch(() => undefined);
    draft.markSent();
    onDraftChanged();
    setIsOpen(false);
    resetEditor();
    attachments.discard(false);
    returnFocus.restore();
  }, [attachments, draft, onDraftChanged, resetEditor, returnFocus]);
  const schedule = useComposerSchedule({
    attachments, body, draft, enabled: scheduledSendEnabled, fields, handleSessionFailure,
    isAccountCurrent: (key) => accountKeyRef.current === key,
    onScheduled, openAccountKey,
  });
  const recoveryFlow = useComposerRecoveryFlow({
    accountKey, attachments, autosaveEnabled: draftsEnabled, draft, enabled: Boolean(recoveryOwner),
    hydration: recovery.hydration, isComposerReady, isOpen,
    journal: recovery.journal, openAccountKey,
    paused: close.isClosing || isSending || schedule.isScheduling ||
      schedule.isOpen || confirmClose || confirmDiscard || templates.isApplying,
    resetEditor, returnFocus,
    setConfirmClose, setConfirmDiscard, setError, setIsOpen, setOpenAccountKey,
  });
  const beginOpen = useCallback((title: ComposerTitle) => {
    if (!accountKey || !isComposerReady || recoveryFlow.hasCandidate) return null;
    returnFocus.remember();
    draft.reset();
    resetEditor();
    fields.setTitle(title);
    const composeId = attachments.discard(true);
    void attachments.refreshCapability();
    setOpenAccountKey(accountKey);
    setIsOpen(true);
    return composeId;
  }, [accountKey, attachments, draft, fields, isComposerReady,
    recoveryFlow.hasCandidate, resetEditor, returnFocus]);
  const open = useCallback(() => {
    if (!beginOpen("New message")) return;
    signatures.prepare("new");
    if (hasDefaultSignature(signatureBook, "newMessageId")) {
      draft.markProgrammaticChange();
    }
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
  const isOpenForAccount = isOpen && openAccountKey === accountKey;
  useEffect(() => {
    if (!isOpen || openAccountKey === accountKey) return;
    setIsOpen(false);
    setIsSending(false);
    draft.reset();
    attachments.discard(true);
    resetEditor();
  }, [accountKey, attachments, draft, isOpen, openAccountKey, resetEditor]);
  const isBusy = close.isClosing || isSending || schedule.isScheduling ||
    draft.isDiscarding || draft.isLoading || templates.isApplying;
  useComposerFocusTrap(isOpenForAccount, isBusy, close.requestClose);
  const recoveryCheckpoint = { composeId: attachments.draftId,
    generation: draft.contentGeneration, snapshot: recovery.hydration.snapshot };
  const onSubmit = useComposerSubmit({
    attachments, body, fields, handleSessionFailure,
    draftSendBlockedMessage: draft.sendBlockedMessage,
    isAccountCurrent: (key) => accountKeyRef.current === key,
    isDraftBusy: close.isClosing || draft.isDiscarding || draft.isLoading ||
      draft.phase === "saving" || templates.isApplying,
    isDraftReadOnly: !draft.canEdit,
    onDraftSent: () => { draft.markSent(); onDraftChanged(); },
    onSendUncertain: draft.markSendUncertain,
    onSent, openAccountKey, providerDraft: draft.providerDraft,
    recovery: recovery.journal.port, recoveryCheckpoint,
    resetFields: resetEditor, restoreFocus: returnFocus.restore,
    setError, setIsOpen, setIsSending,
  });
  return {
    ...fields, attachmentCapabilityUnavailable: attachments.capabilityUnavailable,
    attachments: attachments.attachments, body, close: close.requestClose,
    closeConfirmationOpen: confirmClose, discardConfirmationOpen: confirmDiscard,
    draft, draftStatus: recoveryFlow.status, error, recoveryPrompt: recoveryFlow.prompt,
    isAttachmentCapabilityRefreshing: attachments.isCapabilityRefreshing,
    isBusy, isOpen: isOpenForAccount, isSending, isUploading: attachments.isUploading,
    maxAttachmentBytes: attachments.maxFileBytes,
    onAttachmentInput: attachments.onFiles, onCancelClose: close.cancelClose,
    onCancelDiscard: close.cancelDiscard, onConfirmClose: close.confirmClose,
    onConfirmDiscard: close.confirmDiscard, onRequestDiscard: close.requestDiscard,
    onRetryAttachmentCapability: attachments.refreshCapability,
    onSubmit, open, openForward, openReply, openReplyAll, openSavedDraft,
    requiresSignOutConfirmation:
      draft.hasUnsavedChanges || recoveryFlow.hasPersistedRecovery,
    removeAttachment: attachments.remove, retryAttachment: attachments.retry,
    schedule, signatures, templates,
  };
};
