"use client";

import { useCallback, useEffect, useState, type ChangeEventHandler } from "react";

import type { ScheduledMessage, ScheduledMessageBook } from "@/domain/mail/scheduled-send";
import {
  browserTimeZone,
  localDateTimeValue,
  scheduledLocalTimeToIso,
} from "@/presentation/features/mail-workspace/composer-schedule-time";
import type { MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import type { ScheduledSendManagerViewModel } from "@/presentation/features/mail-workspace/scheduled-send-manager.view-model";
import { mailApi } from "@/transport/client/api-client";
import { ApiClientError } from "@/transport/client/api-request";

const emptyBook: ScheduledMessageBook = { messages: [], revision: null, version: 1 };
const limits = () => {
  const now = Date.now();
  return {
    maximum: localDateTimeValue(new Date(now + 366 * 24 * 60 * 60 * 1_000)),
    minimum: localDateTimeValue(new Date(now + 60_000)),
  };
};

export const useScheduledSendManager = (
  sessionScope: string,
  handleSessionFailure: MailSessionFailureHandler,
): ScheduledSendManagerViewModel & { readonly refresh: () => Promise<void> } => {
  const [book, setBook] = useState(emptyBook);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isAvailable, setIsAvailable] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<ScheduledMessage | null>(null);
  const [rescheduleTime, setRescheduleTime] = useState("");
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);
  const [timeLimits, setTimeLimits] = useState(limits);
  const [timeZone] = useState(browserTimeZone);
  const refresh = useCallback(async () => {
    if (!sessionScope) { setBook(emptyBook); return; }
    setIsLoading(true); setError(null);
    try {
      setBook(await mailApi.getScheduledMessages(sessionScope));
      setIsAvailable(true);
    } catch (nextError) {
      if (!handleSessionFailure(nextError)) {
        if (nextError instanceof ApiClientError &&
          nextError.code === "SCHEDULED_SEND_UNAVAILABLE") setIsAvailable(false);
        setError(nextError instanceof Error
          ? nextError.message : "Unable to load scheduled messages.");
      }
    } finally { setIsLoading(false); }
  }, [handleSessionFailure, sessionScope]);
  useEffect(() => { void refresh(); }, [refresh]);
  const open = useCallback(() => { setIsOpen(true); void refresh(); }, [refresh]);
  const close = useCallback(() => {
    if (!isMutating) { setIsOpen(false); setTarget(null); }
  }, [isMutating]);
  const cancel = useCallback(async (message: ScheduledMessage) => {
    if (isMutating) return;
    setIsMutating(true); setError(null);
    try {
      await mailApi.cancelScheduledMessage(message.id, sessionScope);
      await refresh();
    } catch (nextError) {
      if (!handleSessionFailure(nextError)) setError(nextError instanceof Error
        ? nextError.message : "Unable to remove this scheduled message.");
    } finally { setIsMutating(false); }
  }, [handleSessionFailure, isMutating, refresh, sessionScope]);
  const requestReschedule = useCallback((message: ScheduledMessage) => {
    setTarget(message); setRescheduleTime(localDateTimeValue(new Date(message.scheduledAt)));
    setRescheduleError(null); setTimeLimits(limits());
  }, []);
  const onRescheduleTimeInput: ChangeEventHandler<HTMLInputElement> = useCallback(
    (event) => { setRescheduleTime(event.currentTarget.value); setRescheduleError(null); },
    [],
  );
  const confirmReschedule = useCallback(async () => {
    if (!target || isMutating) return;
    const scheduledAt = scheduledLocalTimeToIso(rescheduleTime);
    if (!scheduledAt) { setRescheduleError("Choose a valid future time."); return; }
    setIsMutating(true); setRescheduleError(null);
    try {
      setBook(await mailApi.rescheduleMessage(target.id, scheduledAt, sessionScope));
      setTarget(null);
    } catch (nextError) {
      if (!handleSessionFailure(nextError)) setRescheduleError(nextError instanceof Error
        ? nextError.message : "Unable to reschedule this message.");
    } finally { setIsMutating(false); }
  }, [handleSessionFailure, isMutating, rescheduleTime, sessionScope, target]);
  return {
    count: book.messages.length, error, isAvailable, isLoading, isMutating, isOpen,
    messages: book.messages, onCancelMessage: cancel, onClose: close,
    onConfirmReschedule: confirmReschedule, onOpen: open,
    onRequestReschedule: requestReschedule,
    onRescheduleCancel: () => setTarget(null), onRescheduleTimeInput,
    onRetry: refresh, refresh, rescheduleError,
    rescheduleMaximum: timeLimits.maximum, rescheduleMinimum: timeLimits.minimum,
    rescheduleTarget: target, rescheduleTime, timeZone,
  };
};
