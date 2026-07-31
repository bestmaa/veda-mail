"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEventHandler,
} from "react";
import {
  createForwardDraft,
  createReplyAllDraft,
  createReplyDraft,
  formatAddressInput,
} from "@/domain/mail/compose";
import type { ComposeInput, MessageDetail, SendReceipt } from "@/domain/mail/mail";
import type { EmailSignatureBook } from "@/domain/member/email-signature";
import { useComposerAttachments } from "@/presentation/features/mail-workspace/hooks/use-composer-attachments";
import { useComposerBody } from "@/presentation/features/mail-workspace/hooks/use-composer-body";
import {
  useComposerFocusTrap,
  useComposerReturnFocus,
} from "@/presentation/features/mail-workspace/hooks/use-composer-focus";
import { useComposerSubmit } from "@/presentation/features/mail-workspace/hooks/use-composer-submit";
import { useComposerSignatures } from "@/presentation/features/mail-workspace/hooks/use-composer-signatures";
import {
  ignoreMailSessionFailure,
  type MailSessionFailureHandler,
} from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
type ComposerTitle = "Forward message" | "New message" | "Reply all" | "Reply";
export const useComposerModel = (
  onSent: (receipt: SendReceipt, submittedEmails: readonly string[]) => void,
  maxAttachmentBytes: number | null,
  signatureBook: EmailSignatureBook | null = null,
  accountKey = "",
  isComposerReady = true,
  initialAttachmentSessionScope = "",
  handleSessionFailure: MailSessionFailureHandler = ignoreMailSessionFailure,
) => {
  const [isOpen, setIsOpen] = useState(false);
  const [openAccountKey, setOpenAccountKey] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState("");
  const [inReplyTo, setInReplyTo] = useState<ComposeInput["inReplyTo"]>();
  const [title, setTitle] = useState<ComposerTitle>("New message");
  const [error, setError] = useState<string | null>(null);
  const accountKeyRef = useRef(accountKey);
  useLayoutEffect(() => { accountKeyRef.current = accountKey; }, [accountKey]);
  const attachments = useComposerAttachments(
    maxAttachmentBytes,
    accountKey,
    initialAttachmentSessionScope,
    handleSessionFailure,
  );
  const signatures = useComposerSignatures(signatureBook);
  const {
    detach: detachSignature,
    prepare: prepareSignatures,
    reset: resetSignatures,
  } = signatures;
  const body = useComposerBody(isSending, detachSignature);
  const { loadPlainDraft, reset: resetBody } = body;
  const returnFocus = useComposerReturnFocus();
  const resetFields = useCallback(() => {
    setTo("");
    setCc("");
    setBcc("");
    setShowCc(false);
    setShowBcc(false);
    setSubject("");
    resetBody();
    resetSignatures();
    setOpenAccountKey("");
    setInReplyTo(undefined);
    setTitle("New message");
    setError(null);
  }, [resetBody, resetSignatures]);

  const open = useCallback(() => {
    if (!accountKey || !isComposerReady) return;
    returnFocus.remember();
    resetFields();
    prepareSignatures("new");
    attachments.discard(true);
    void attachments.refreshCapability();
    setOpenAccountKey(accountKey);
    setIsOpen(true);
  }, [
    accountKey,
    attachments,
    isComposerReady,
    prepareSignatures,
    resetFields,
    returnFocus,
  ]);

  const openDraft = useCallback(
    (draft: ComposeInput, nextTitle: ComposerTitle) => {
      if (!accountKey || !isComposerReady) return null;
      returnFocus.remember();
      const draftId = attachments.discard(true);
      void attachments.refreshCapability();
      setTo(formatAddressInput(draft.to));
      setCc(formatAddressInput(draft.cc));
      setBcc(formatAddressInput(draft.bcc));
      setShowCc(draft.cc.length > 0);
      setShowBcc(draft.bcc.length > 0);
      setSubject(draft.subject);
      loadPlainDraft(draft.body);
      prepareSignatures("reply-forward");
      setInReplyTo(draft.inReplyTo);
      setTitle(nextTitle);
      setError(null);
      setOpenAccountKey(accountKey);
      setIsOpen(true);
      return draftId;
    },
    [
      accountKey,
      attachments,
      isComposerReady,
      loadPlainDraft,
      prepareSignatures,
      returnFocus,
    ],
  );

  const openReply = useCallback(
    (message: MessageDetail | null) =>
      message && openDraft(createReplyDraft(message), "Reply"),
    [openDraft],
  );

  const openReplyAll = useCallback(
    (message: MessageDetail | null, signedInEmail: string) =>
      message &&
      openDraft(createReplyAllDraft(message, signedInEmail), "Reply all"),
    [openDraft],
  );
  const openForward = useCallback(
    (message: MessageDetail | null) => {
      if (message) {
        const draftId = openDraft(createForwardDraft(message), "Forward message");
        if (draftId) {
          attachments.importOriginalAttachments(message, draftId);
        }
      }
    },
    [attachments, openDraft],
  );

  const close = useCallback(() => {
    if (isSending) return;
    setIsOpen(false);
    setOpenAccountKey("");
    setError(null);
    attachments.discard(true);
    resetSignatures();
    returnFocus.restore();
  }, [attachments, isSending, resetSignatures, returnFocus]);

  const isOpenForAccount = isOpen && openAccountKey === accountKey;
  useEffect(() => {
    if (!isOpen || openAccountKey === accountKey) return;
    setIsOpen(false);
    setOpenAccountKey("");
    setIsSending(false);
    setError(null);
    attachments.discard(true);
    resetFields();
  }, [accountKey, attachments, isOpen, openAccountKey, resetFields]);

  useComposerFocusTrap(isOpenForAccount, isSending, close);
  const onToInput: ChangeEventHandler<HTMLInputElement> = useCallback((event) => setTo(event.target.value), []);
  const onCcInput: ChangeEventHandler<HTMLInputElement> = useCallback((event) => setCc(event.target.value), []);
  const onBccInput: ChangeEventHandler<HTMLInputElement> = useCallback((event) => setBcc(event.target.value), []);
  const onSubjectInput: ChangeEventHandler<HTMLInputElement> = useCallback((event) => setSubject(event.target.value), []);
  const onToggleBcc = useCallback(
    () => setShowBcc((isVisible) => (bcc.trim() ? true : !isVisible)),
    [bcc],
  );
  const onToggleCc = useCallback(
    () => setShowCc((isVisible) => (cc.trim() ? true : !isVisible)),
    [cc],
  );

  const onSubmit = useComposerSubmit({
    attachments,
    bcc,
    body,
    cc,
    inReplyTo,
    handleSessionFailure,
    isAccountCurrent: (submittedAccountKey) =>
      accountKeyRef.current === submittedAccountKey,
    onSent,
    openAccountKey,
    resetFields,
    restoreFocus: returnFocus.restore,
    setError,
    setIsOpen,
    setIsSending,
    subject,
    to,
  });

  return {
    attachmentCapabilityUnavailable: attachments.capabilityUnavailable,
    attachments: attachments.attachments,
    bcc,
    body,
    cc,
    close,
    error,
    isAttachmentCapabilityRefreshing: attachments.isCapabilityRefreshing,
    isOpen: isOpenForAccount,
    isSending,
    isUploading: attachments.isUploading,
    maxAttachmentBytes: attachments.maxFileBytes,
    onBccInput,
    onAttachmentInput: attachments.onFiles,
    onCcInput,
    onRetryAttachmentCapability: attachments.refreshCapability,
    onToggleBcc,
    onToggleCc,
    removeAttachment: attachments.remove,
    retryAttachment: attachments.retry,
    onSubjectInput,
    onSubmit,
    onToInput,
    open,
    openForward,
    openReply,
    openReplyAll,
    showBcc,
    showCc,
    signatures,
    subject,
    title,
    to,
  };
};
