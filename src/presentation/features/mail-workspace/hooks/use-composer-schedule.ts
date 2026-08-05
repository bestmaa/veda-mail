"use client";

import { useCallback, useState, type ChangeEventHandler } from "react";

import { parseRecipientInputs } from "@/domain/mail/compose";
import {
  browserTimeZone,
  defaultScheduledLocalTime,
  localDateTimeValue,
  scheduledLocalTimeToIso,
} from "@/presentation/features/mail-workspace/composer-schedule-time";
import type { useComposerAttachments } from "@/presentation/features/mail-workspace/hooks/use-composer-attachments";
import type { useComposerBody } from "@/presentation/features/mail-workspace/hooks/use-composer-body";
import type { useComposerDraft } from "@/presentation/features/mail-workspace/hooks/use-composer-draft";
import type { useComposerFields } from "@/presentation/features/mail-workspace/hooks/use-composer-fields";
import type { MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import { EXPIRED_ATTACHMENT_MESSAGE } from "@/presentation/features/mail-workspace/hooks/composer-attachment-upload-registry";
import { mailApi } from "@/transport/client/api-client";
import { useModalDialogFocus } from "@/presentation/shared/hooks/use-modal-dialog-focus";

interface ComposerScheduleOptions {
  readonly attachments: ReturnType<typeof useComposerAttachments>;
  readonly body: ReturnType<typeof useComposerBody>;
  readonly draft: ReturnType<typeof useComposerDraft>;
  readonly fields: ReturnType<typeof useComposerFields>;
  readonly handleSessionFailure: MailSessionFailureHandler;
  readonly isAccountCurrent: (accountKey: string) => boolean;
  readonly onScheduled: () => Promise<void>;
  readonly openAccountKey: string;
  readonly preferredTimeZone?: string;
  readonly enabled: boolean;
}

const scheduleTimeLimits = (timeZone?: string) => {
  const now = Date.now();
  return {
    maximum: localDateTimeValue(
      new Date(now + 366 * 24 * 60 * 60 * 1_000), timeZone,
    ),
    minimum: localDateTimeValue(new Date(now + 60_000), timeZone),
  };
};

export const useComposerSchedule = ({
  attachments, body, draft, fields, handleSessionFailure, isAccountCurrent,
  onScheduled, openAccountKey, preferredTimeZone, enabled,
}: ComposerScheduleOptions) => {
  const timeZone = preferredTimeZone || browserTimeZone();
  const [isOpen, setIsOpen] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const [localTime, setLocalTime] = useState(
    () => defaultScheduledLocalTime(new Date(), timeZone),
  );
  const [error, setError] = useState<string | null>(null);
  const [limits, setLimits] = useState(() => scheduleTimeLimits(timeZone));

  const open = useCallback(() => {
    if (!enabled) return;
    setLocalTime(defaultScheduledLocalTime(new Date(), timeZone));
    setLimits(scheduleTimeLimits(timeZone));
    setError(null);
    setIsOpen(true);
  }, [enabled, timeZone]);
  const cancel = useCallback(() => {
    if (!isScheduling) setIsOpen(false);
  }, [isScheduling]);
  useModalDialogFocus(
    isOpen, "#composer-schedule-dialog", cancel, 'input[type="datetime-local"]',
  );
  const onTimeInput: ChangeEventHandler<HTMLInputElement> = useCallback(
    (event) => { setLocalTime(event.currentTarget.value); setError(null); },
    [],
  );
  const confirm = useCallback(async () => {
    if (isScheduling || !openAccountKey || !isAccountCurrent(openAccountKey)) return;
    const recipients = parseRecipientInputs(fields);
    if (recipients.to.length + recipients.cc.length + recipients.bcc.length === 0) {
      setError("Add at least one recipient."); return;
    }
    if (!body.text.trim()) { setError("Message body cannot be blank."); return; }
    if (attachments.isUploading || attachments.hasError) {
      setError(attachments.isUploading
        ? "Wait for attachment uploads to finish."
        : "Remove failed attachments before scheduling.");
      return;
    }
    if (attachments.expireReady()) { setError(EXPIRED_ATTACHMENT_MESSAGE); return; }
    const scheduledAt = scheduledLocalTimeToIso(localTime, new Date(), timeZone);
    if (!scheduledAt) {
      setError("Choose a valid future time within the next 366 days."); return;
    }
    setIsScheduling(true); setError(null);
    try {
      const saved = await draft.saveDetail();
      if (!saved?.composeId || !isAccountCurrent(openAccountKey)) {
        if (!saved) setError("Save the draft before scheduling this message.");
        return;
      }
      await mailApi.scheduleMessage({
        attachmentIds: [], bcc: recipients.bcc, ...body.payload,
        cc: recipients.cc, draftId: saved.composeId,
        expectedDraftRevision: saved.revision,
        ...(fields.inReplyTo ? { inReplyTo: fields.inReplyTo } : {}),
        providerDraftId: saved.id, subject: fields.subject, to: recipients.to,
      }, scheduledAt, openAccountKey);
      if (!isAccountCurrent(openAccountKey)) return;
      setIsOpen(false);
      await onScheduled();
    } catch (nextError) {
      if (!isAccountCurrent(openAccountKey) || handleSessionFailure(nextError)) return;
      setError(nextError instanceof Error
        ? nextError.message : "Unable to schedule this message.");
    } finally {
      if (isAccountCurrent(openAccountKey)) setIsScheduling(false);
    }
  }, [attachments, body.payload, body.text, draft, fields, handleSessionFailure,
    isAccountCurrent, isScheduling, localTime, onScheduled, openAccountKey,
    timeZone]);

  return {
    cancel, confirm, error, isAvailable: enabled, isOpen, isScheduling,
    localTime, onTimeInput,
    ...limits, open, timeZone,
  };
};
