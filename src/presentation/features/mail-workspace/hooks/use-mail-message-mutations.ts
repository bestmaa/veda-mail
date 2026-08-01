"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import type { BulkMessageMutation, MessageDetail } from "@/domain/mail/mail";
import type { LabelId, MailboxId, MessageId } from "@/domain/shared/brand";
import type { MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import type { OptimisticMutationToken } from "@/presentation/features/mail-workspace/hooks/use-mail-session-scope-state";
import { mailApi } from "@/transport/client/api-client";
import { ApiClientError } from "@/transport/client/api-request";
import { validateBulkMessageMutationResult } from "@/transport/client/bulk-message-mutation-result";

type SelectedMessageMutation =
  | { readonly type: "archive" | "delete" | "restore" }
  | { readonly mailboxId: MailboxId; readonly type: "destroy" }
  | { readonly type: "set-read" | "set-starred"; readonly value: boolean }
  | { readonly labelId: LabelId; readonly type: "set-label"; readonly value: boolean };

interface MailMessageMutationOptions {
  readonly activeMailboxId: MailboxId | null;
  readonly beginOptimisticMutation: (input: {
    readonly activeMailboxId: MailboxId | null;
    readonly mutation: BulkMessageMutation;
    readonly sessionScope: string;
    readonly viewKey: string;
  }) => OptimisticMutationToken | null;
  readonly clearMessage: () => void;
  readonly currentMessageId: () => MessageId | null;
  readonly currentViewRevision: () => number;
  readonly handleSessionFailure: MailSessionFailureHandler;
  readonly isCurrentScope: (expectedScope: string) => boolean;
  readonly markOptimisticMutationUnconfirmed: (token: OptimisticMutationToken) => boolean;
  readonly refresh: () => void;
  readonly refreshCurrentView: () => Promise<boolean>;
  readonly selectedMessage: MessageDetail | null;
  readonly sessionScope: string;
  readonly setReaderError: Dispatch<SetStateAction<string | null>>;
  readonly settleOptimisticMutation: (token: OptimisticMutationToken,
    succeeded: readonly MessageId[], unconfirmed?: readonly MessageId[]) => boolean;
  readonly viewKey: string;
}

interface ReaderMutationTransaction {
  readonly sessionScope: string;
  readonly token: OptimisticMutationToken;
  readonly viewKey: string;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Something went wrong.";

export const useMailMessageMutations = ({
  activeMailboxId,
  beginOptimisticMutation,
  clearMessage,
  currentMessageId,
  currentViewRevision,
  handleSessionFailure,
  isCurrentScope,
  markOptimisticMutationUnconfirmed,
  refresh,
  refreshCurrentView,
  selectedMessage,
  sessionScope,
  setReaderError,
  settleOptimisticMutation,
  viewKey,
}: MailMessageMutationOptions) => {
  const [isBusy, setIsBusy] = useState(false);
  const inFlightScope = useRef<string | null>(null);
  const operationId = useRef(0);
  const transactionRef = useRef<ReaderMutationTransaction | null>(null);
  const reconcile = useCallback(async (transaction: ReaderMutationTransaction) => {
    clearMessage();
    const accepted = await refreshCurrentView();
    if (!isCurrentScope(transaction.sessionScope)) return;
    if (accepted) settleOptimisticMutation(transaction.token, []);
    else markOptimisticMutationUnconfirmed(transaction.token);
  }, [clearMessage, isCurrentScope, markOptimisticMutationUnconfirmed,
    refreshCurrentView, settleOptimisticMutation]);
  useEffect(() => {
    const transaction = transactionRef.current;
    if (!transaction) return;
    if (transaction.sessionScope !== sessionScope) {
      transactionRef.current = null;
      inFlightScope.current = null;
      operationId.current += 1;
      setIsBusy(false);
      return;
    }
    if (transaction.viewKey === viewKey) return;
    transactionRef.current = null;
    operationId.current += 1;
    void reconcile(transaction);
  }, [reconcile, sessionScope, viewKey]);
  const mutateSelected = useCallback(
    async (mutation: SelectedMessageMutation) => {
      if (!selectedMessage || !sessionScope || inFlightScope.current) return;
      const requestScope = sessionScope;
      const messageId = selectedMessage.id;
      const request = {
        ...mutation,
        messageIds: [messageId],
      } as BulkMessageMutation;
      const transaction = beginOptimisticMutation({
        activeMailboxId,
        mutation: request,
        sessionScope: requestScope,
        viewKey,
      });
      if (!transaction) return;
      const expectedViewRevision = currentViewRevision();
      const expectedOperation = ++operationId.current;
      const transactionState: ReaderMutationTransaction = {
        sessionScope: requestScope,
        token: transaction,
        viewKey,
      };
      transactionRef.current = transactionState;
      inFlightScope.current = requestScope;
      setIsBusy(true);
      setReaderError(null);
      try {
        const rawResult = await mailApi.mutateMessages(request, requestScope);
        const result = validateBulkMessageMutationResult(rawResult, [messageId]);
        if (!isCurrentScope(requestScope)) return;
        if (
          expectedOperation !== operationId.current ||
          expectedViewRevision !== currentViewRevision()
        ) {
          transactionRef.current = null;
          await reconcile(transactionState);
          return;
        }
        const unconfirmed = result.unconfirmed ?? [];
        if (unconfirmed.length > 0) {
          transactionRef.current = null;
          await reconcile(transactionState);
        } else {
          settleOptimisticMutation(transaction, result.succeeded);
          transactionRef.current = null;
        }
        if (result.failed.length > 0 && currentMessageId() === messageId) {
          setReaderError("The mail provider rejected this update. The previous state was restored.");
        }
        if (result.succeeded.length > 0) refresh();
      } catch (nextError) {
        if (!isCurrentScope(requestScope)) return;
        if (handleSessionFailure(nextError)) return;
        const isDefiniteRejection =
          nextError instanceof ApiClientError &&
          nextError.status >= 400 &&
          nextError.status < 500;
        if (isDefiniteRejection) {
          settleOptimisticMutation(transaction, []);
          transactionRef.current = null;
        } else {
          transactionRef.current = null;
          await reconcile(transactionState);
        }
        if (currentMessageId() === messageId) {
          setReaderError(
            isDefiniteRejection
              ? errorMessage(nextError)
              : "The update could not be confirmed. This message is being refreshed.",
          );
        }
      } finally {
        if (inFlightScope.current === requestScope) {
          transactionRef.current = null;
          inFlightScope.current = null;
          setIsBusy(false);
        }
      }
    },
    [
      activeMailboxId,
      beginOptimisticMutation,
      currentViewRevision,
      currentMessageId,
      handleSessionFailure,
      isCurrentScope,
      reconcile,
      refresh,
      selectedMessage,
      sessionScope,
      setReaderError,
      settleOptimisticMutation,
      viewKey,
    ],
  );

  const toggleStar = useCallback(() => {
    if (selectedMessage) {
      void mutateSelected({
        type: "set-starred",
        value: !selectedMessage.isStarred,
      });
    }
  }, [mutateSelected, selectedMessage]);
  const toggleRead = useCallback(() => {
    if (selectedMessage) {
      void mutateSelected({
        type: "set-read",
        value: selectedMessage.isUnread,
      });
    }
  }, [mutateSelected, selectedMessage]);

  return {
    archive: useCallback(
      () => void mutateSelected({ type: "archive" }),
      [mutateSelected],
    ),
    remove: useCallback(
      () => void mutateSelected({ type: "delete" }),
      [mutateSelected],
    ),
    destroy: useCallback(
      (mailboxId: MailboxId) =>
        void mutateSelected({ mailboxId, type: "destroy" }),
      [mutateSelected],
    ),
    isBusy,
    restore: useCallback(
      () => void mutateSelected({ type: "restore" }),
      [mutateSelected],
    ),
    setLabel: useCallback(
      (labelId: LabelId, value: boolean) =>
        void mutateSelected({ labelId, type: "set-label", value }),
      [mutateSelected],
    ),
    toggleRead,
    toggleStar,
  };
};
