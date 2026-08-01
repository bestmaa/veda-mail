"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  BulkMessageMutation,
  MessageSummary,
} from "@/domain/mail/mail";
import type { MailboxId, MessageId } from "@/domain/shared/brand";
import type { MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import {
  retainAvailableSelection,
  retainFailedSelection,
  selectLoadedMessages,
  toggleBulkSelection,
} from "@/presentation/features/mail-workspace/mail-bulk-selection";
import { mailApi } from "@/transport/client/api-client";

export type BulkMessageAction =
  | { readonly type: "archive" | "delete" | "restore" }
  | {
      readonly type: "set-read" | "set-starred";
      readonly value: boolean;
    }
  | { readonly mailboxId: MailboxId; readonly type: "destroy" | "move" };

interface MailBulkSelectionOptions {
  readonly currentViewRevision: () => number;
  readonly handleSessionFailure: MailSessionFailureHandler;
  readonly isCurrentScope: (scope: string) => boolean;
  readonly messages: readonly MessageSummary[];
  readonly onSucceeded: (messageIds: readonly MessageId[]) => void;
  readonly refresh: () => void;
  readonly sessionScope: string;
  readonly viewKey: string;
}

const messageFor = (error: unknown): string =>
  error instanceof Error ? error.message : "Unable to update the messages.";

const mutationRequest = (
  action: BulkMessageAction,
  messageIds: readonly MessageId[],
): BulkMessageMutation => {
  if (action.type === "set-read" || action.type === "set-starred") {
    return { messageIds, type: action.type, value: action.value };
  }
  if (action.type === "destroy" || action.type === "move") {
    return { mailboxId: action.mailboxId, messageIds, type: action.type };
  }
  return { messageIds, type: action.type };
};

export const useMailBulkSelection = ({
  currentViewRevision,
  handleSessionFailure,
  isCurrentScope,
  messages,
  onSucceeded,
  refresh,
  sessionScope,
  viewKey,
}: MailBulkSelectionOptions) => {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<MessageId>>(
    () => new Set(),
  );
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const inFlight = useRef(false);
  const operationId = useRef(0);

  useEffect(() => {
    operationId.current += 1;
    inFlight.current = false;
    setSelectedIds(new Set());
    setError(null);
    setStatus("");
    setIsBusy(false);
  }, [sessionScope, viewKey]);

  useEffect(() => {
    const available = new Set(messages.map((message) => message.id));
    setSelectedIds((current) =>
      retainAvailableSelection(current, available),
    );
  }, [messages]);

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

  const mutate = useCallback(
    async (action: BulkMessageAction) => {
      if (inFlight.current || !sessionScope || selectedIds.size === 0) return;
      const expectedViewRevision = currentViewRevision();
      const expectedOperation = ++operationId.current;
      const messageIds = [...selectedIds];
      inFlight.current = true;
      setIsBusy(true);
      setError(null);
      setStatus("");
      try {
        const result = await mailApi.mutateMessages(
          mutationRequest(action, messageIds),
          sessionScope,
        );
        if (
          expectedOperation !== operationId.current ||
          currentViewRevision() !== expectedViewRevision ||
          !isCurrentScope(sessionScope)
        ) {
          return;
        }
        setSelectedIds((current) =>
          retainFailedSelection(current, result.failed),
        );
        const succeededCount = result.succeeded.length;
        const failedCount = result.failed.length;
        if (succeededCount > 0) {
          onSucceeded(result.succeeded);
          refresh();
        }
        setStatus(
          failedCount
            ? `${succeededCount} updated; ${failedCount} failed and remain selected.`
            : `${succeededCount} ${succeededCount === 1 ? "message" : "messages"} updated.`,
        );
      } catch (nextError) {
        if (
          expectedOperation !== operationId.current ||
          currentViewRevision() !== expectedViewRevision ||
          !isCurrentScope(sessionScope)
        ) {
          return;
        }
        if (handleSessionFailure(nextError)) return;
        setError(messageFor(nextError));
      } finally {
        if (expectedOperation === operationId.current) {
          inFlight.current = false;
          setIsBusy(false);
        }
      }
    },
    [
      handleSessionFailure,
      currentViewRevision,
      isCurrentScope,
      onSucceeded,
      refresh,
      selectedIds,
      sessionScope,
    ],
  );

  const loadedIds = messages.map((message) => message.id);
  return {
    allLoadedSelected:
      loadedIds.length > 0 &&
      loadedIds.every((messageId) => selectedIds.has(messageId)),
    clear,
    error,
    isBusy,
    mutate,
    selectedIds,
    status,
    toggle,
    toggleAllLoaded,
  };
};
