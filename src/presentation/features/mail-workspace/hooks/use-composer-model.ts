"use client";

import {
  useCallback,
  useState,
  type ChangeEventHandler,
  type FormEventHandler,
} from "react";
import {
  createForwardDraft,
  createReplyAllDraft,
  createReplyDraft,
  formatAddressInput,
  parseRecipientInputs,
} from "@/domain/mail/compose";
import type { ComposeInput, MessageDetail, SendReceipt } from "@/domain/mail/mail";
import { EXPIRED_ATTACHMENT_MESSAGE } from "@/presentation/features/mail-workspace/hooks/composer-attachment-upload-registry";
import {
  attachmentRecoveryMessage,
  composerSendErrorMessage,
} from "@/presentation/features/mail-workspace/hooks/composer-send-error";
import { useComposerAttachments } from "@/presentation/features/mail-workspace/hooks/use-composer-attachments";
import { useComposerBody } from "@/presentation/features/mail-workspace/hooks/use-composer-body";
import {
  useComposerFocusTrap,
  useComposerReturnFocus,
} from "@/presentation/features/mail-workspace/hooks/use-composer-focus";
import { mailApi } from "@/transport/client/api-client";

type ComposerTitle = "Forward message" | "New message" | "Reply all" | "Reply";
export const useComposerModel = (
  onSent: (receipt: SendReceipt, submittedEmails: readonly string[]) => void,
  maxAttachmentBytes: number | null,
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
  const body = useComposerBody(isSending);
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
    setInReplyTo(undefined);
    setTitle("New message");
    setError(null);
  }, [resetBody]);

  const open = useCallback(() => {
    returnFocus.remember();
    resetFields();
    attachments.discard(true);
    void attachments.refreshCapability();
    setIsOpen(true);
  }, [attachments, resetFields, returnFocus]);

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
      setInReplyTo(draft.inReplyTo);
      setTitle(nextTitle);
      setError(null);
      setIsOpen(true);
      return draftId;
    },
    [attachments, loadPlainDraft, returnFocus],
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
    returnFocus.restore();
  }, [attachments, isSending, returnFocus]);

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

  const onSubmit: FormEventHandler<HTMLFormElement> = useCallback(
    async (event) => {
      event.preventDefault();
      const recipients = parseRecipientInputs({ bcc, cc, to });
      if (
        recipients.to.length + recipients.cc.length + recipients.bcc.length ===
        0
      ) {
        setError("Add at least one recipient.");
        return;
      }
      if (!body.text.trim()) {
        setError("Message body cannot be blank.");
        return;
      }
      if (attachments.isUploading || attachments.hasError) {
        setError(
          attachments.isUploading
            ? "Wait for attachment uploads to finish."
            : "Remove failed attachments before sending.",
        );
        return;
      }
      if (attachments.expireReady())
        return setError(EXPIRED_ATTACHMENT_MESSAGE);
      setIsSending(true);
      setError(null);
      try {
        const receipt = await mailApi.sendMessage({
          attachmentIds: attachments.attachmentIds,
          bcc: recipients.bcc,
          ...body.payload,
          cc: recipients.cc,
          draftId: attachments.draftId,
          ...(inReplyTo ? { inReplyTo } : {}),
          subject,
          to: recipients.to,
        });
        setIsOpen(false);
        resetFields();
        attachments.discard(false);
        returnFocus.restore();
        onSent(receipt, [...recipients.to, ...recipients.cc, ...recipients.bcc].map(({ email }) => email));
      } catch (nextError) {
        const recovery = attachmentRecoveryMessage(nextError);
        if (recovery) attachments.invalidateReady(recovery);
        setError(recovery ?? composerSendErrorMessage(nextError));
      } finally {
        setIsSending(false);
      }
    },
    [
      attachments,
      bcc,
      body.payload,
      body.text,
      cc,
      inReplyTo,
      onSent,
      resetFields,
      returnFocus,
      subject,
      to,
    ],
  );

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
    subject,
    title,
    to,
  };
};
