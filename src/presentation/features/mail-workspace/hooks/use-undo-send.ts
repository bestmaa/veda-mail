"use client";

import { useCallback, useEffect, useState } from "react";

import type { ScheduledMessage } from "@/domain/mail/scheduled-send";
import type { ProviderDraftId } from "@/domain/shared/brand";
import type { MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import type { UndoSendViewModel } from "@/presentation/features/mail-workspace/undo-send.view-model";
import { mailApi } from "@/transport/client/api-client";

interface QueuedUndo {
  readonly message: ScheduledMessage;
  readonly providerDraftId: ProviderDraftId;
  readonly sessionScope: string;
}

interface UndoSendOptions {
  readonly handleSessionFailure: MailSessionFailureHandler;
  readonly onChanged: () => void;
  readonly openSavedDraft: (providerDraftId: string) => void;
  readonly sessionScope: string;
}

export const useUndoSend = ({
  handleSessionFailure,
  onChanged,
  openSavedDraft,
  sessionScope,
}: UndoSendOptions) => {
  const [queued, setQueued] = useState<QueuedUndo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUndoing, setIsUndoing] = useState(false);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!queued) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [queued]);
  useEffect(() => {
    if (queued && queued.sessionScope !== sessionScope) {
      setQueued(null); setError(null); setIsUndoing(false);
    }
  }, [queued, sessionScope]);
  useEffect(() => {
    if (
      queued && !isUndoing && !error &&
      Date.parse(queued.message.scheduledAt) <= now
    ) setQueued(null);
  }, [error, isUndoing, now, queued]);
  const queue = useCallback((
    message: ScheduledMessage,
    providerDraftId: ProviderDraftId,
  ) => {
    setNow(Date.now()); setError(null);
    setQueued({ message, providerDraftId, sessionScope });
  }, [sessionScope]);
  const dismiss = useCallback(() => { setQueued(null); setError(null); }, []);
  const undo = useCallback(async () => {
    if (!queued || isUndoing) return;
    setIsUndoing(true); setError(null);
    try {
      await mailApi.cancelScheduledMessage(queued.message.id, queued.sessionScope);
      setQueued(null);
      openSavedDraft(queued.providerDraftId);
      onChanged();
    } catch (nextError) {
      if (handleSessionFailure(nextError)) return;
      setError(nextError instanceof Error
        ? nextError.message
        : "This message could no longer be undone.");
    } finally {
      setIsUndoing(false);
    }
  }, [handleSessionFailure, isUndoing, onChanged, openSavedDraft, queued]);
  const milliseconds = queued ? Date.parse(queued.message.scheduledAt) - now : 0;
  const view: UndoSendViewModel = {
    error,
    isUndoing,
    isVisible: Boolean(queued),
    onDismiss: dismiss,
    onUndo: () => { void undo(); },
    secondsRemaining: Math.max(0, Math.ceil(milliseconds / 1_000)),
    subject: queued?.message.subject || "(No subject)",
  };
  return { queue, view };
};
