"use client";

import {
  useCallback,
  type Dispatch,
  type FormEventHandler,
  type SetStateAction,
} from "react";

import type { SavedProviderDraft } from "@/domain/mail/draft";
import type { SendReceipt } from "@/domain/mail/mail";
import { parseRecipientInputs } from "@/domain/mail/compose";
import { SAVED_DRAFT_ATTACHMENT_SEND_MESSAGE } from "@/presentation/features/mail-workspace/composer-draft-state";
import { EXPIRED_ATTACHMENT_MESSAGE } from "@/presentation/features/mail-workspace/hooks/composer-attachment-upload-registry";
import {
  attachmentRecoveryMessage,
  composerSendErrorMessage,
} from "@/presentation/features/mail-workspace/hooks/composer-send-error";
import type { useComposerAttachments } from "@/presentation/features/mail-workspace/hooks/use-composer-attachments";
import type { useComposerBody } from "@/presentation/features/mail-workspace/hooks/use-composer-body";
import type { useComposerFields } from "@/presentation/features/mail-workspace/hooks/use-composer-fields";
import { mailApi } from "@/transport/client/api-client";
import type { MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";

interface ComposerSubmitOptions {
  readonly attachments: ReturnType<typeof useComposerAttachments>;
  readonly body: ReturnType<typeof useComposerBody>;
  readonly draftSendBlockedMessage: string | null;
  readonly fields: ReturnType<typeof useComposerFields>;
  readonly handleSessionFailure: MailSessionFailureHandler;
  readonly isAccountCurrent: (accountKey: string) => boolean;
  readonly isDraftBusy: boolean;
  readonly isDraftReadOnly: boolean;
  readonly onDraftSent: () => void;
  readonly onSent: (
    receipt: SendReceipt,
    submittedEmails: readonly string[],
  ) => void;
  readonly openAccountKey: string;
  readonly providerDraft: SavedProviderDraft | null;
  readonly resetFields: () => void;
  readonly restoreFocus: () => void;
  readonly setError: Dispatch<SetStateAction<string | null>>;
  readonly setIsOpen: Dispatch<SetStateAction<boolean>>;
  readonly setIsSending: Dispatch<SetStateAction<boolean>>;
}

export const useComposerSubmit = ({
  attachments,
  body,
  draftSendBlockedMessage,
  fields,
  handleSessionFailure,
  isAccountCurrent,
  isDraftBusy,
  isDraftReadOnly,
  onDraftSent,
  onSent,
  openAccountKey,
  providerDraft,
  resetFields,
  restoreFocus,
  setError,
  setIsOpen,
  setIsSending,
}: ComposerSubmitOptions): FormEventHandler<HTMLFormElement> =>
  useCallback(
    async (event) => {
      event.preventDefault();
      const submittedAccountKey = openAccountKey;
      if (
        !submittedAccountKey ||
        !isAccountCurrent(submittedAccountKey) ||
        isDraftBusy ||
        isDraftReadOnly
      ) {
        return;
      }
      if (draftSendBlockedMessage) {
        setError(draftSendBlockedMessage);
        return;
      }
      const recipients = parseRecipientInputs(fields);
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
      if (providerDraft && attachments.attachmentIds.length > 0) {
        setError(SAVED_DRAFT_ATTACHMENT_SEND_MESSAGE);
        return;
      }
      setIsSending(true);
      setError(null);
      try {
        const receipt = await mailApi.sendMessage(
          {
            attachmentIds: attachments.attachmentIds,
            bcc: recipients.bcc,
            ...body.payload,
            cc: recipients.cc,
            draftId: providerDraft?.composeId ?? attachments.draftId,
            ...(fields.inReplyTo ? { inReplyTo: fields.inReplyTo } : {}),
            ...(providerDraft ? {
              expectedDraftRevision: providerDraft.expectedRevision,
              providerDraftId: providerDraft.id,
            } : {}),
            subject: fields.subject,
            to: recipients.to,
          },
          submittedAccountKey,
        );
        if (!isAccountCurrent(submittedAccountKey)) return;
        setIsOpen(false);
        onDraftSent();
        resetFields();
        attachments.discard(false);
        restoreFocus();
        onSent(receipt, submittedEmails);
      } catch (error) {
        if (!isAccountCurrent(submittedAccountKey)) return;
        if (handleSessionFailure(error)) return;
        const recovery = attachmentRecoveryMessage(error);
        if (recovery) attachments.invalidateReady(recovery);
        setError(recovery ?? composerSendErrorMessage(error));
      } finally {
        if (isAccountCurrent(submittedAccountKey)) {
          setIsSending(false);
        }
      }
    },
    [
      attachments,
      body.payload,
      body.text,
      draftSendBlockedMessage,
      fields,
      handleSessionFailure,
      isAccountCurrent,
      isDraftBusy,
      isDraftReadOnly,
      onDraftSent,
      onSent,
      openAccountKey,
      providerDraft,
      resetFields,
      restoreFocus,
      setError,
      setIsOpen,
      setIsSending,
    ],
  );
