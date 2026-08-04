"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { MailboxRole, MessageSummary } from "@/domain/mail/mail";
import type { MailboxId, MessageId } from "@/domain/shared/brand";
import type { OptimisticMutationToken } from "@/presentation/features/mail-workspace/optimistic-message-state";
import type { MailSnoozeViewModel } from "@/presentation/features/mail-workspace/mail-snooze.view-model";
import { snoozeStatusLabel } from "@/presentation/features/mail-workspace/mail-snooze.view-model";
import {
  snoozeBrowserTimeZone, snoozeLocalDateTimeValue, snoozeLocalTimeToIso, snoozePresets, snoozeTimeLimits,
} from "@/presentation/features/mail-workspace/mail-snooze-time";
import type { MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import { useModalDialogFocus } from "@/presentation/shared/hooks/use-modal-dialog-focus";
import { ApiClientError } from "@/transport/client/api-request";
import { snoozeApi, type SnoozeWorkspaceSnapshot } from "@/transport/client/snooze-api";
import { mailboxCanSnooze, snoozeOutcome } from "@/presentation/features/mail-workspace/mail-snooze-policy";

interface SnoozeTarget { readonly messageId: MessageId; readonly sourceMailboxId: MailboxId; readonly subject: string }
interface MailSnoozeOptions {
  readonly activeMailbox: { readonly id: MailboxId; readonly role: MailboxRole } | null;
  readonly beginOptimistic: (messageIds: readonly MessageId[], destinationMailboxId: MailboxId) => OptimisticMutationToken | null;
  readonly handleSessionFailure: MailSessionFailureHandler;
  readonly markUnconfirmed: (token: OptimisticMutationToken) => void;
  readonly messages: readonly MessageSummary[];
  readonly pendingMessageIds: ReadonlySet<string>;
  readonly refresh: () => void;
  readonly selectedIds: ReadonlySet<MessageId>;
  readonly selectedMessage: MessageSummary | null;
  readonly sessionScope: string;
  readonly settleOptimistic: (token: OptimisticMutationToken, succeeded: readonly MessageId[]) => void;
}

const message = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;
const displayDate = (value: string): string => new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium", timeStyle: "short",
}).format(new Date(value));

export const useMailSnoozeModel = (options: MailSnoozeOptions): MailSnoozeViewModel => {
  const { activeMailbox, beginOptimistic, handleSessionFailure, markUnconfirmed,
    messages, pendingMessageIds, refresh, selectedIds, selectedMessage,
    sessionScope, settleOptimistic } = options;
  const [snapshot, setSnapshot] = useState<SnoozeWorkspaceSnapshot | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [targets, setTargets] = useState<readonly SnoozeTarget[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [localTime, setLocalTime] = useState("");
  const [limits, setLimits] = useState(() => snoozeTimeLimits());
  const [presets, setPresets] = useState(() => snoozePresets());
  const [error, setError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const scopeRef = useRef(sessionScope);
  const operationId = useRef(0);
  const readId = useRef(0);
  const inFlight = useRef(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!sessionScope) return;
    const requestId = ++readId.current;
    setIsLoading(true);
    try {
      const next = await snoozeApi.get(sessionScope, signal);
      if (scopeRef.current === sessionScope && requestId === readId.current) setSnapshot(next);
    } catch (caught) {
      if (!signal?.aborted && scopeRef.current === sessionScope && requestId === readId.current && !handleSessionFailure(caught)) {
        setError(message(caught, "Unable to load snoozed messages."));
      }
    } finally { if (scopeRef.current === sessionScope && requestId === readId.current) setIsLoading(false); }
  }, [handleSessionFailure, sessionScope]);

  useEffect(() => {
    scopeRef.current = sessionScope; operationId.current += 1; readId.current += 1; inFlight.current = false;
    setSnapshot(null); setManagerOpen(false); setDialogOpen(false); setTargets([]);
    setEditingId(null); setError(null); setDialogError(null); setIsBusy(false);
    const controller = new AbortController(); void load(controller.signal);
    return () => controller.abort();
  }, [load, sessionScope]);

  const closeDialog = useCallback(() => { if (!isBusy) setDialogOpen(false); }, [isBusy]);
  const closeManager = useCallback(() => { if (!isBusy) setManagerOpen(false); }, [isBusy]);
  useModalDialogFocus(dialogOpen, "#mail-snooze-dialog", closeDialog, '[data-snooze-initial-focus]');
  useModalDialogFocus(managerOpen, "#snoozed-manager-dialog", closeManager, "[data-snoozed-manager-initial-focus]");
  const openTargets = useCallback((nextTargets: readonly SnoozeTarget[], editId: string | null = null, wakeAt?: string) => {
    if (!nextTargets.length && !editId) return;
    const now = new Date(); const nextPresets = snoozePresets(now);
    setTargets(nextTargets); setEditingId(editId); setPresets(nextPresets);
    setLimits(snoozeTimeLimits(now)); setLocalTime(wakeAt ?? nextPresets[1]!.value);
    setDialogError(null); setDialogOpen(true);
  }, []);

  const runJobAction = useCallback(async (
    action: "restore" | "retry", snoozeId: string,
  ) => {
    if (!sessionScope || isBusy || inFlight.current) return;
    const requestScope = sessionScope; const requestId = ++operationId.current;
    inFlight.current = true; setIsBusy(true); setError(null);
    try {
      const book = await snoozeApi[action](snoozeId, requestScope);
      if (scopeRef.current === requestScope && requestId === operationId.current) {
        readId.current += 1; setSnapshot((current) => current ? { ...current, book } : current); refresh();
      }
    } catch (caught) {
      if (scopeRef.current === requestScope && requestId === operationId.current && !handleSessionFailure(caught)) {
        setError(message(caught, `Unable to ${action} this message.`));
      }
    } finally {
      if (scopeRef.current === requestScope && requestId === operationId.current) { inFlight.current = false; setIsBusy(false); }
    }
  }, [handleSessionFailure, isBusy, refresh, sessionScope]);

  const confirm = useCallback(async () => {
    const wakeAt = snoozeLocalTimeToIso(localTime);
    if (!wakeAt) { setDialogError("Choose a valid future time within the next 366 days."); return; }
    if (!sessionScope || isBusy || inFlight.current) return;
    const requestScope = sessionScope; const requestId = ++operationId.current;
    inFlight.current = true; setIsBusy(true); setDialogError(null);
    if (editingId) {
      try {
        const book = await snoozeApi.reschedule(editingId, wakeAt, requestScope);
        if (scopeRef.current === requestScope && requestId === operationId.current) {
          readId.current += 1; setSnapshot((current) => current ? { ...current, book } : current); setDialogOpen(false);
        }
      } catch (caught) {
        if (scopeRef.current === requestScope && requestId === operationId.current && !handleSessionFailure(caught)) setDialogError(message(caught, "Unable to change snooze time."));
      } finally { if (scopeRef.current === requestScope && requestId === operationId.current) { inFlight.current = false; setIsBusy(false); } }
      return;
    }
    const capability = snapshot?.capability;
    if (!capability?.supported) { inFlight.current = false; setIsBusy(false); setDialogError(capability?.reason ?? "Snooze is unavailable."); return; }
    const destinationMailboxId = capability.snoozedMailboxId ?? snapshot?.book.snoozedMailboxId;
    const token = destinationMailboxId
      ? beginOptimistic(targets.map(({ messageId }) => messageId), destinationMailboxId)
      : null;
    if (destinationMailboxId && !token) { inFlight.current = false; setIsBusy(false); setDialogError("Another message update is still running."); return; }
    try {
      const result = await snoozeApi.create(targets.map(({ messageId, sourceMailboxId }) => ({ messageId, sourceMailboxId, wakeAt })), requestScope);
      if (scopeRef.current !== requestScope || requestId !== operationId.current) return;
      const { accepted, rejected } = snoozeOutcome(result.outcomes);
      if (token) settleOptimistic(token, accepted);
      readId.current += 1; setSnapshot((current) => current ? { ...current, book: result.book } : current);
      if (rejected.length) setError(`${accepted.length} snoozed; ${rejected.length} rejected and restored.`);
      setDialogOpen(false); refresh();
    } catch (caught) {
      if (scopeRef.current !== requestScope || requestId !== operationId.current) return;
      if (handleSessionFailure(caught)) return;
      if (token && caught instanceof ApiClientError && caught.status >= 400 && caught.status < 500) {
        settleOptimistic(token, []); setDialogError(message(caught, "Unable to snooze these messages."));
      } else {
        if (token) markUnconfirmed(token);
        setDialogOpen(false); setError("Snooze could not be confirmed. Mail is being refreshed before you retry."); refresh();
      }
    } finally { if (scopeRef.current === requestScope && requestId === operationId.current) { inFlight.current = false; setIsBusy(false); } }
  }, [beginOptimistic, editingId, handleSessionFailure, isBusy, localTime, markUnconfirmed, refresh, sessionScope, settleOptimistic, snapshot?.book.snoozedMailboxId, snapshot?.capability, targets]);

  const ownedMailboxId = snapshot?.capability.snoozedMailboxId ?? snapshot?.book.snoozedMailboxId ?? null;
  const activeEligible = mailboxCanSnooze(activeMailbox, ownedMailboxId, snapshot?.capability.supported ?? false);
  const jobs = (snapshot?.book.messages ?? []).map((job) => ({ ...job,
    statusLabel: snoozeStatusLabel(job.status), wakeLabel: displayDate(job.wakeAt) }));
  return {
    canSnoozeBulk: Boolean(activeEligible && selectedIds.size),
    canSnoozeReader: Boolean(activeEligible && selectedMessage),
    dialog: { confirmLabel: editingId ? "Save time" : "Snooze", error: dialogError, isBusy, isOpen: dialogOpen, localTime,
      ...limits, onCancel: closeDialog, onConfirm: () => void confirm(),
      onPreset: (value) => { setLocalTime(value); setDialogError(null); },
      onTimeInput: (event) => { setLocalTime(event.currentTarget.value); setDialogError(null); },
      presets: presets.map((preset) => ({ ...preset, resolved: displayDate(new Date(preset.value).toISOString()) })),
      resolvedUtc: snoozeLocalTimeToIso(localTime), targetLabel: editingId ? "Change snooze time" : targets.length === 1 ? `Snooze “${targets[0]?.subject}”` : `Snooze ${targets.length} messages`, timeZone: snoozeBrowserTimeZone() },
    error, isBusy, isLoading, jobs,
    manager: { close: closeManager, isOpen: managerOpen, open: () => { setManagerOpen(true); void load(); } },
    onOpenBulk: () => activeMailbox && openTargets(messages.filter(({ id }) => selectedIds.has(id)).map(({ id, subject }) => ({ messageId: id, sourceMailboxId: activeMailbox.id, subject: subject || "(No subject)" }))),
    onOpenReader: () => activeMailbox && selectedMessage && openTargets([{ messageId: selectedMessage.id, sourceMailboxId: activeMailbox.id, subject: selectedMessage.subject || "(No subject)" }]),
    onReschedule: (job) => { setManagerOpen(false); openTargets([], job.id, snoozeLocalDateTimeValue(new Date(job.wakeAt))); },
    onRestore: (snoozeId) => void runJobAction("restore", snoozeId),
    onRetry: (snoozeId) => void runJobAction("retry", snoozeId),
    pendingMessageIds, snoozedMailboxId: ownedMailboxId,
    supported: snapshot?.capability.supported ?? false,
  };
};
