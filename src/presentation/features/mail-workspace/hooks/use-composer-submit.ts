"use client";

import { useCallback, useRef, type Dispatch, type SetStateAction } from "react";

import type { DraftDetail, SavedProviderDraft } from "@/domain/mail/draft";
import type { SendReceipt } from "@/domain/mail/mail";
import type { UndoSendDelay } from "@/domain/mail/message-list-preferences";
import type { ScheduledMessage } from "@/domain/mail/scheduled-send";
import type { DraftId, ProviderDraftId } from "@/domain/shared/brand";
import { parseRecipientInputs } from "@/domain/mail/compose";
import { SAVED_DRAFT_ATTACHMENT_SEND_MESSAGE } from "@/presentation/features/mail-workspace/composer-draft-state";
import type { ComposerRecoverySnapshot } from "@/presentation/features/mail-workspace/composer-recovery.types";
import { EXPIRED_ATTACHMENT_MESSAGE } from "@/presentation/features/mail-workspace/hooks/composer-attachment-upload-registry";
import {
  attachmentRecoveryMessage,
  composerSendErrorMessage,
  isAmbiguousComposerSendFailure,
} from "@/presentation/features/mail-workspace/hooks/composer-send-error";
import type { useComposerAttachments } from "@/presentation/features/mail-workspace/hooks/use-composer-attachments";
import type { useComposerBody } from "@/presentation/features/mail-workspace/hooks/use-composer-body";
import type { useComposerFields } from "@/presentation/features/mail-workspace/hooks/use-composer-fields";
import { mailApi } from "@/transport/client/api-client";
import type { MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import type { ComposerRecoveryJournalPort } from "@/presentation/features/mail-workspace/hooks/use-composer-recovery-journal";
import { queueComposerUndoSend } from "@/presentation/features/mail-workspace/hooks/queue-composer-undo-send";

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
  readonly onUndoQueued?: (message: ScheduledMessage,
    providerDraftId: ProviderDraftId) => Promise<void> | void;
  readonly onSendUncertain: () => void;
  readonly onSent: (
    receipt: SendReceipt,
    submittedEmails: readonly string[],
  ) => void;
  readonly openAccountKey: string;
  readonly providerDraft: SavedProviderDraft | null;
  readonly recovery: ComposerRecoveryJournalPort;
  readonly recoveryCheckpoint: {
    readonly composeId: DraftId;
    readonly generation: number;
    readonly snapshot: ComposerRecoverySnapshot;
  };
  readonly resetFields: () => void;
  readonly restoreFocus: () => void;
  readonly setError: Dispatch<SetStateAction<string | null>>;
  readonly setIsOpen: Dispatch<SetStateAction<boolean>>;
  readonly setIsSending: Dispatch<SetStateAction<boolean>>;
  readonly saveDraft?: () => Promise<DraftDetail | null>;
  readonly undoSendSeconds?: UndoSendDelay;
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
  onUndoQueued,
  onSendUncertain,
  onSent,
  openAccountKey,
  providerDraft,
  recovery,
  recoveryCheckpoint,
  resetFields,
  restoreFocus,
  setError,
  setIsOpen,
  setIsSending,
  saveDraft,
  undoSendSeconds = 0,
}: ComposerSubmitOptions): (() => Promise<void>) => {
  const submissionInFlight = useRef(false);
  return useCallback(
    async () => {
      if (submissionInFlight.current) return;
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
      if (
        undoSendSeconds === 0 && providerDraft &&
        attachments.attachmentIds.length > 0
      ) {
        setError(SAVED_DRAFT_ATTACHMENT_SEND_MESSAGE);
        return;
      }
      submissionInFlight.current = true;
      setIsSending(true);
      setError(null);
      let terminalIntentId: string | null = null;
      try {
        if (undoSendSeconds !== 0) {
          const queued = saveDraft ? await queueComposerUndoSend({
            content: {
              bcc: recipients.bcc, ...body.payload, cc: recipients.cc,
              ...(fields.inReplyTo ? { inReplyTo: fields.inReplyTo } : {}),
              subject: fields.subject, to: recipients.to,
            },
            saveDraft,
            seconds: undoSendSeconds,
            sessionScope: submittedAccountKey,
          }) : null;
          if (!queued) {
            setError("Save the draft before starting the undo window.");
            return;
          }
          if (!isAccountCurrent(submittedAccountKey)) return;
          await onUndoQueued?.(
            queued.result.createdMessage,
            queued.providerDraftId,
          );
          return;
        }
        const prepared = await recovery.prepareSend(
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
          recoveryCheckpoint,
        );
        if (!prepared) {
          setError("Couldn’t secure this send attempt. Keep this tab open and retry.");
          return;
        }
        terminalIntentId = prepared.intentId;
        const receipt = await mailApi.sendMessage(
          prepared.request,
          submittedAccountKey,
        );
        if (!isAccountCurrent(submittedAccountKey)) return;
        try {
          if (!await recovery.completeTerminal(prepared.intentId)) {
            await recovery.markSendUncertain(prepared.intentId);
          }
        } catch {
          await recovery.markSendUncertain(prepared.intentId).catch(() => false);
        }
        setIsOpen(false);
        onDraftSent();
        resetFields();
        attachments.discard(false);
        restoreFocus();
        onSent(receipt, submittedEmails);
      } catch (error) {
        if (!isAccountCurrent(submittedAccountKey)) return;
        if (handleSessionFailure(error)) return;
        if (terminalIntentId) {
          const ambiguous = isAmbiguousComposerSendFailure(error);
          const transition = ambiguous
            ? recovery.markSendUncertain(terminalIntentId)
            : recovery.rejectTerminal(terminalIntentId);
          await transition.catch(() => false);
          if (ambiguous) {
            onSendUncertain();
            setError(null);
            return;
          }
        }
        const attachmentFailure = attachmentRecoveryMessage(error);
        if (attachmentFailure) attachments.invalidateReady(attachmentFailure);
        setError(attachmentFailure ?? composerSendErrorMessage(error));
      } finally {
        submissionInFlight.current = false;
        if (isAccountCurrent(submittedAccountKey)) {
          setIsSending(false);
        }
      }
    },
    [
      attachments, body.payload, body.text, draftSendBlockedMessage, fields,
      handleSessionFailure, isAccountCurrent, isDraftBusy, isDraftReadOnly,
      onDraftSent, onUndoQueued, onSendUncertain, onSent, openAccountKey,
      providerDraft, recovery, recoveryCheckpoint, resetFields, restoreFocus,
      setError, setIsOpen, setIsSending, saveDraft, undoSendSeconds,
    ],
  );
};
