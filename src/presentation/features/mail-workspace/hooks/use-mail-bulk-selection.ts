"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MessageId } from "@/domain/shared/brand";
import type { OptimisticMutationToken } from "@/presentation/features/mail-workspace/hooks/use-mail-session-scope-state";
import type { MailBulkSelectionOptions } from "@/presentation/features/mail-workspace/hooks/mail-bulk-selection.options";
import { reconcilePendingSelection, replaceOperationSelection,
  retainAvailableSelection, selectLoadedMessages, toggleBulkSelection,
} from "@/presentation/features/mail-workspace/mail-bulk-selection";
import { bulkMessageOperationLimitError, canStopBulkMessageOperation,
  mutationRequest, runBulkMessageOperation, type BulkMessageAction,
} from "@/presentation/features/mail-workspace/bulk-message-operation";
import { completedBulkSelectionOutcome, interruptedBulkSelectionOutcome } from "@/presentation/features/mail-workspace/bulk-selection-outcome";
import { ApiClientError } from "@/transport/client/api-request";
export type { BulkMessageAction } from "@/presentation/features/mail-workspace/bulk-message-operation";
const messageFor = (error: unknown): string =>
  error instanceof Error ? error.message : "Unable to update the messages.";
export const useMailBulkSelection = ({
  activeMailboxId,
  beginOptimisticMutation,
  currentViewRevision,
  handleSessionFailure,
  isCurrentScope,
  messages,
  optimisticPendingIds,
  refresh,
  sessionScope,
  settleOptimisticMutation,
  viewKey,
}: MailBulkSelectionOptions) => {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<MessageId>>(
    () => new Set(),
  );
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [canStop, setCanStop] = useState(false);
  const pendingIds = useRef<ReadonlySet<MessageId>>(new Set());
  const inFlight = useRef(false);
  const stopRequested = useRef(false);
  const operationId = useRef(0);
  const transactionRef = useRef<OptimisticMutationToken | null>(null);
  useEffect(() => {
    if (inFlight.current) {
      stopRequested.current = true;
      setCanStop(false);
      setStatus("Stopping after the current batch...");
      return;
    }
    operationId.current += 1;
    inFlight.current = false;
    setSelectedIds(new Set());
    setError(null);
    setStatus("");
    setIsBusy(false);
    setCanStop(false);
    pendingIds.current = new Set();
  }, [sessionScope, viewKey]);
  useEffect(() => {
    const activePending = [...pendingIds.current].filter((id) =>
      optimisticPendingIds.has(id));
    pendingIds.current = new Set(activePending);
    const available = new Set([
      ...messages.map((message) => message.id),
      ...activePending,
    ]);
    setSelectedIds((current) => retainAvailableSelection(current, available));
  }, [messages, optimisticPendingIds]);
  const clear = useCallback(() => {
    if (inFlight.current) return;
    setSelectedIds(new Set());
    setError(null);
    setStatus("");
  }, []);
  const toggle = useCallback((messageId: MessageId) => {
    if (inFlight.current) return;
    setSelectedIds((current) => toggleBulkSelection(current, messageId));
    setError(null);
    setStatus("");
  }, []);
  const toggleAllLoaded = useCallback(() => {
    if (inFlight.current) return;
    const loadedIds = messages.map((message) => message.id);
    const allSelected =
      loadedIds.length > 0 &&
      loadedIds.every((messageId) => selectedIds.has(messageId));
    setSelectedIds(allSelected ? new Set() : selectLoadedMessages(loadedIds));
    setError(null);
    setStatus("");
  }, [messages, selectedIds]);
  const stop = useCallback(() => {
    if (!inFlight.current) return;
    stopRequested.current = true;
    setCanStop(false);
    setStatus("Stopping after the current batch...");
  }, []);
  const mutateIds = useCallback(
    async (
      action: BulkMessageAction,
      requestedIds: readonly MessageId[],
    ) => {
      const messageIds = [...new Set(requestedIds)];
      if (inFlight.current || !sessionScope || messageIds.length === 0) return;
      const limitError = bulkMessageOperationLimitError(messageIds);
      if (limitError) { setError(limitError); return; }
      const expectedOperation = ++operationId.current;
      const request = mutationRequest(action, messageIds);
      const transaction = beginOptimisticMutation({
        activeMailboxId,
        mutation: request,
        sessionScope,
        viewKey,
      });
      if (!transaction) return;
      const expectedViewRevision = currentViewRevision();
      const succeeded: MessageId[] = [];
      const failed: MessageId[] = [];
      const submitted: MessageId[] = [];
      const unconfirmed: MessageId[] = [];
      transactionRef.current = transaction;
      inFlight.current = true;
      stopRequested.current = false;
      setIsBusy(true);
      setCanStop(canStopBulkMessageOperation(messageIds));
      pendingIds.current = new Set([...pendingIds.current, ...messageIds]);
      setError(null);
      setStatus(
        `Updating ${messageIds.length} ${messageIds.length === 1 ? "message" : "messages"}…`,
      );
      try {
        const stopped = await runBulkMessageOperation({
          action,
          currentViewRevision,
          expectedViewRevision,
          failed,
          isCurrent: () =>
            expectedOperation === operationId.current &&
            isCurrentScope(sessionScope),
          messageIds,
          shouldStop: () => stopRequested.current,
          sessionScope,
          submitted,
          succeeded,
          unconfirmed,
        });
        if (
          expectedOperation !== operationId.current ||
          !isCurrentScope(sessionScope)
        ) {
          return;
        }
        const outcome = completedBulkSelectionOutcome({
          action, failed, messageIds, stopped, submitted, succeeded, unconfirmed,
        });
        settleOptimisticMutation(transaction, succeeded, outcome.pending);
        transactionRef.current = null;
        pendingIds.current = reconcilePendingSelection(pendingIds.current,
          messageIds, outcome.pending);
        setSelectedIds((current) => replaceOperationSelection(
          current, messageIds, outcome.retry));
        if (outcome.shouldRefresh) refresh();
        setStatus(outcome.status);
        setError(outcome.error);
      } catch (nextError) {
        if (
          expectedOperation !== operationId.current ||
          !isCurrentScope(sessionScope)
        ) {
          return;
        }
        if (handleSessionFailure(nextError)) return;
        const isDefiniteRejection =
          nextError instanceof ApiClientError &&
          nextError.status >= 400 &&
          nextError.status < 500;
        const outcome = interruptedBulkSelectionOutcome({
          definiteRejection: isDefiniteRejection, failed, messageIds, submitted,
          succeeded, unconfirmed, errorMessage: messageFor(nextError),
        });
        setSelectedIds((current) => replaceOperationSelection(
          current, messageIds, outcome.retry));
        if (isDefiniteRejection) {
          settleOptimisticMutation(transaction, succeeded);
        } else {
          settleOptimisticMutation(transaction, succeeded, outcome.pending);
        }
        pendingIds.current = reconcilePendingSelection(pendingIds.current,
          messageIds, outcome.pending);
        transactionRef.current = null;
        refresh();
        setStatus(outcome.status);
        setError(outcome.error);
      } finally {
        if (expectedOperation === operationId.current) {
          inFlight.current = false;
          stopRequested.current = false;
          setIsBusy(false);
          setCanStop(false);
          transactionRef.current = null;
        }
      }
    },
    [
      handleSessionFailure,
      activeMailboxId,
      beginOptimisticMutation,
      currentViewRevision,
      isCurrentScope,
      refresh,
      sessionScope,
      settleOptimisticMutation,
      viewKey,
    ],
  );
  const mutate = useCallback(
    (action: BulkMessageAction) => mutateIds(action, [...selectedIds]),
    [mutateIds, selectedIds],
  );
  const loadedIds = messages.map((message) => message.id);
  return {
    allLoadedSelected:
      loadedIds.length > 0 &&
      loadedIds.every((messageId) => selectedIds.has(messageId)),
    canStop,
    clear,
    error,
    isBusy,
    mutate,
    mutateIds,
    selectedIds,
    status,
    stop,
    toggle,
    toggleAllLoaded,
  };
};
