"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  BulkMessageMutation,
  MessageSummary,
} from "@/domain/mail/mail";
import type { LabelId, MailboxId, MessageId } from "@/domain/shared/brand";
import type { MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import {
  retainAvailableSelection,
  selectLoadedMessages,
  toggleBulkSelection,
} from "@/presentation/features/mail-workspace/mail-bulk-selection";
import { chunkMessageIds } from "@/presentation/features/mail-workspace/message-move-policy";
import { mailApi } from "@/transport/client/api-client";

export type BulkMessageAction =
  | { readonly type: "archive" | "delete" | "restore" }
  | {
      readonly type: "set-read" | "set-starred";
      readonly value: boolean;
    }
  | { readonly labelId: LabelId; readonly type: "set-label"; readonly value: boolean }
  | { readonly mailboxId: MailboxId; readonly type: "destroy" }
  | {
      readonly destinationMailboxId: MailboxId;
      readonly sourceMailboxId: MailboxId;
      readonly type: "move";
    };

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
  if (action.type === "set-label") {
    return {
      labelId: action.labelId,
      messageIds,
      type: action.type,
      value: action.value,
    };
  }
  if (action.type === "destroy") {
    return { mailboxId: action.mailboxId, messageIds, type: action.type };
  }
  if (action.type === "move") {
    return {
      destinationMailboxId: action.destinationMailboxId,
      messageIds,
      sourceMailboxId: action.sourceMailboxId,
      type: action.type,
    };
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

  const mutateIds = useCallback(
    async (
      action: BulkMessageAction,
      requestedIds: readonly MessageId[],
    ) => {
      const messageIds = [...new Set(requestedIds)];
      if (inFlight.current || !sessionScope || messageIds.length === 0) return;
      const expectedViewRevision = currentViewRevision();
      const expectedOperation = ++operationId.current;
      const succeeded: MessageId[] = [];
      const failed: MessageId[] = [];
      inFlight.current = true;
      setIsBusy(true);
      setError(null);
      setStatus("");
      try {
        for (const batch of chunkMessageIds(messageIds)) {
          if (
            expectedOperation !== operationId.current ||
            currentViewRevision() !== expectedViewRevision ||
            !isCurrentScope(sessionScope)
          ) return;
          const result = await mailApi.mutateMessages(
            mutationRequest(action, batch),
            sessionScope,
          );
          succeeded.push(...result.succeeded);
          failed.push(...result.failed);
        }
        if (
          expectedOperation !== operationId.current ||
          currentViewRevision() !== expectedViewRevision ||
          !isCurrentScope(sessionScope)
        ) {
          return;
        }
        setSelectedIds(() => new Set(failed));
        const succeededCount = succeeded.length;
        const failedCount = failed.length;
        if (succeededCount > 0) {
          onSucceeded(succeeded);
          refresh();
        }
        const verb = action.type === "move" ? "moved" : "updated";
        setStatus(
          failedCount
            ? `${succeededCount} ${verb}; ${failedCount} failed and remain selected.`
            : `${succeededCount} ${succeededCount === 1 ? "message" : "messages"} ${verb}.`,
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
        const succeededIds = new Set(succeeded);
        const unconfirmed = messageIds.filter((messageId) =>
          !succeededIds.has(messageId),
        );
        setSelectedIds(new Set(unconfirmed));
        if (succeeded.length > 0) {
          onSucceeded(succeeded);
          refresh();
          setStatus(
            `${succeeded.length} updated; ${unconfirmed.length} could not be confirmed and remain selected.`,
          );
        }
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
      sessionScope,
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
    clear,
    error,
    isBusy,
    mutate,
    mutateIds,
    selectedIds,
    status,
    toggle,
    toggleAllLoaded,
  };
};
