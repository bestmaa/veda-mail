"use client";

import {
  useCallback,
  type Dispatch,
  type FormEventHandler,
  type SetStateAction,
} from "react";

import type { ComposeInput, SendReceipt } from "@/domain/mail/mail";
import { parseRecipientInputs } from "@/domain/mail/compose";
import { EXPIRED_ATTACHMENT_MESSAGE } from "@/presentation/features/mail-workspace/hooks/composer-attachment-upload-registry";
import {
  attachmentRecoveryMessage,
  composerSendErrorMessage,
} from "@/presentation/features/mail-workspace/hooks/composer-send-error";
import type { useComposerAttachments } from "@/presentation/features/mail-workspace/hooks/use-composer-attachments";
import type { useComposerBody } from "@/presentation/features/mail-workspace/hooks/use-composer-body";
import { mailApi } from "@/transport/client/api-client";

interface ComposerSubmitOptions {
  readonly attachments: ReturnType<typeof useComposerAttachments>;
  readonly bcc: string;
  readonly body: ReturnType<typeof useComposerBody>;
  readonly cc: string;
  readonly inReplyTo: ComposeInput["inReplyTo"];
  readonly onSent: (
    receipt: SendReceipt,
    submittedEmails: readonly string[],
  ) => void;
  readonly resetFields: () => void;
  readonly restoreFocus: () => void;
  readonly setError: Dispatch<SetStateAction<string | null>>;
  readonly setIsOpen: Dispatch<SetStateAction<boolean>>;
  readonly setIsSending: Dispatch<SetStateAction<boolean>>;
  readonly subject: string;
  readonly to: string;
}

export const useComposerSubmit = ({
  attachments,
  bcc,
  body,
  cc,
  inReplyTo,
  onSent,
  resetFields,
  restoreFocus,
  setError,
  setIsOpen,
  setIsSending,
  subject,
  to,
}: ComposerSubmitOptions): FormEventHandler<HTMLFormElement> =>
  useCallback(
    async (event) => {
      event.preventDefault();
      const recipients = parseRecipientInputs({ bcc, cc, to });
      const submittedEmails = [
        ...recipients.to,
        ...recipients.cc,
        ...recipients.bcc,
      ].map(({ email }) => email);
      if (submittedEmails.length === 0) {
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
      if (attachments.expireReady()) {
        setError(EXPIRED_ATTACHMENT_MESSAGE);
        return;
      }
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
        restoreFocus();
        onSent(receipt, submittedEmails);
      } catch (error) {
        const recovery = attachmentRecoveryMessage(error);
        if (recovery) attachments.invalidateReady(recovery);
        setError(recovery ?? composerSendErrorMessage(error));
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
      restoreFocus,
      setError,
      setIsOpen,
      setIsSending,
      subject,
      to,
    ],
  );
