"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { id } from "@/domain/shared/brand";
import type {
  CalendarInvitationResponseChoice,
  CalendarInvitationViewItem,
} from "@/presentation/features/mail-workspace/calendar-invitation.view-model";
import type { MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import { CalendarInvitationView } from "@/presentation/features/mail-workspace/ui/calendar-invitation.view";
import {
  calendarApi,
  type CalendarInvitationSnapshot,
} from "@/transport/client/calendar-api";

const messageFor = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback;

export const CalendarInvitationConnector = ({
  handleSessionFailure,
  messageId,
  sessionScope,
}: {
  readonly handleSessionFailure: MailSessionFailureHandler;
  readonly messageId: string;
  readonly sessionScope: string;
}) => {
  const [snapshot, setSnapshot] = useState<CalendarInvitationSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const responseKeys = useRef(new Map<string, string>());

  useEffect(() => {
    const controller = new AbortController();
    void calendarApi.getInvitations(
      id.message(messageId),
      sessionScope,
      controller.signal,
    ).then(setSnapshot).catch((failure: unknown) => {
      if (controller.signal.aborted || handleSessionFailure(failure)) return;
      setError(messageFor(failure, "Unable to inspect calendar invitations."));
    }).finally(() => {
      if (!controller.signal.aborted) setIsLoading(false);
    });
    return () => controller.abort();
  }, [handleSessionFailure, messageId, sessionScope]);

  const respond = useCallback(async (
    item: CalendarInvitationViewItem,
    choice: CalendarInvitationResponseChoice,
  ) => {
    const action = `${item.part.id}:${choice}`;
    const key = responseKeys.current.get(action) ?? crypto.randomUUID();
    responseKeys.current.set(action, key);
    setBusyAction(action);
    setError(null);
    setStatus(null);
    try {
      const result = await calendarApi.respond(id.message(messageId), {
        idempotencyKey: key,
        partId: item.part.id,
        response: choice,
      }, sessionScope);
      setStatus(result.receipt.deliveryStatus === "accepted"
        ? `Calendar response sent: ${choice}.`
        : "Delivery status could not be verified. Retrying this same action is safe; do not start a new response.");
    } catch (failure) {
      if (!handleSessionFailure(failure)) {
        setError(messageFor(failure, "Unable to send the calendar response."));
      }
    } finally {
      setBusyAction(null);
    }
  }, [handleSessionFailure, messageId, sessionScope]);

  const importEvent = useCallback(async (item: CalendarInvitationViewItem) => {
    setBusyAction(`${item.part.id}:import`);
    setError(null);
    setStatus(null);
    try {
      await calendarApi.importEvent(item.canonicalIcs, sessionScope);
      setStatus(`Added ${item.invitation.event.summary} to your Veda calendar.`);
    } catch (failure) {
      if (!handleSessionFailure(failure)) {
        setError(messageFor(failure, "Unable to add this calendar event."));
      }
    } finally {
      setBusyAction(null);
    }
  }, [handleSessionFailure, sessionScope]);

  const exportEvents = useCallback(async () => {
    setIsExporting(true);
    setError(null);
    try {
      const blob = await calendarApi.exportEvents(sessionScope);
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = "veda-mail-calendar.ics";
      link.click();
      URL.revokeObjectURL(href);
      setStatus("Calendar export downloaded.");
    } catch (failure) {
      if (!handleSessionFailure(failure)) {
        setError(messageFor(failure, "Unable to export your calendar."));
      }
    } finally {
      setIsExporting(false);
    }
  }, [handleSessionFailure, sessionScope]);

  return (
    <CalendarInvitationView
      busyAction={busyAction}
      error={error}
      isExporting={isExporting}
      isLoading={isLoading}
      onExport={exportEvents}
      onImport={importEvent}
      onRespond={respond}
      snapshot={snapshot}
      status={status}
    />
  );
};
