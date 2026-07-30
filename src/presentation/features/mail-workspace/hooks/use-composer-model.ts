"use client";

import {
  useCallback,
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

type ComposerTitle = "Forward message" | "New message" | "Reply all" | "Reply";
export const useComposerModel = (
  onSent: (receipt: SendReceipt, submittedEmails: readonly string[]) => void,
  maxAttachmentBytes: number | null,
  signatureBook: EmailSignatureBook | null = null,
) => {
  const [isOpen, setIsOpen] = useState(false);
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
  const attachments = useComposerAttachments(maxAttachmentBytes);
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
    setInReplyTo(undefined);
    setTitle("New message");
    setError(null);
  }, [resetBody, resetSignatures]);

  const open = useCallback(() => {
    returnFocus.remember();
    resetFields();
    prepareSignatures("new");
    attachments.discard(true);
    void attachments.refreshCapability();
    setIsOpen(true);
  }, [attachments, prepareSignatures, resetFields, returnFocus]);

  const openDraft = useCallback(
    (draft: ComposeInput, nextTitle: ComposerTitle) => {
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
      setIsOpen(true);
      return draftId;
    },
    [attachments, loadPlainDraft, prepareSignatures, returnFocus],
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
        attachments.importOriginalAttachments(message, draftId);
      }
    },
    [attachments, openDraft],
  );

  const close = useCallback(() => {
    if (isSending) return;
    setIsOpen(false);
    setError(null);
    attachments.discard(true);
    resetSignatures();
    returnFocus.restore();
  }, [attachments, isSending, resetSignatures, returnFocus]);

  useComposerFocusTrap(isOpen, isSending, close);

  const onToInput: ChangeEventHandler<HTMLInputElement> = useCallback(
    (event) => setTo(event.target.value),
    [],
  );
  const onCcInput: ChangeEventHandler<HTMLInputElement> = useCallback(
    (event) => setCc(event.target.value),
    [],
  );
  const onBccInput: ChangeEventHandler<HTMLInputElement> = useCallback(
    (event) => setBcc(event.target.value),
    [],
  );
  const onSubjectInput: ChangeEventHandler<HTMLInputElement> = useCallback(
    (event) => setSubject(event.target.value),
    [],
  );
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
    onSent,
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
    isOpen,
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
