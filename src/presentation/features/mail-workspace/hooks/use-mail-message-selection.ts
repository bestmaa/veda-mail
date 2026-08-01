"use client";

import { useCallback, type Dispatch, type SetStateAction } from "react";

import type { MessageDetail } from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import type { MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import { mailApi } from "@/transport/client/api-client";
import { ApiClientError } from "@/transport/client/api-request";
import { validateBulkMessageMutationResult } from "@/transport/client/bulk-message-mutation-result";

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Something went wrong.";

export const useMailMessageSelection = (input: {
  readonly beginRequest: () => number;
  readonly commitMessage: (message: MessageDetail, expectedScope: string) => boolean;
  readonly currentScope: () => string;
  readonly handleSessionFailure: MailSessionFailureHandler;
  readonly isCurrentScope: (scope: string) => boolean;
  readonly isCurrentRequest: (requestId: number) => boolean;
  readonly refreshCurrentView: () => Promise<boolean>;
  readonly setIsReaderLoading: Dispatch<SetStateAction<boolean>>;
  readonly setReaderError: Dispatch<SetStateAction<string | null>>;
}) => {
  const { beginRequest, commitMessage, currentScope, handleSessionFailure,
    isCurrentRequest, isCurrentScope, refreshCurrentView, setIsReaderLoading,
    setReaderError } = input;
  return useCallback(async (messageId: string) => {
  const requestScope = currentScope();
  if (!requestScope) return;
  const typedId = id.message(messageId);
  const requestId = beginRequest();
  setIsReaderLoading(true);
  setReaderError(null);
  try {
    const message = await mailApi.getMessage(typedId, requestScope);
    if (
      !isCurrentRequest(requestId) ||
      !commitMessage(message, requestScope)
    ) return;
    if (message.isUnread) {
      const result = validateBulkMessageMutationResult(
        await mailApi.mutateMessages({
          messageIds: [typedId], type: "set-read", value: true,
        }, requestScope),
        [typedId],
      );
      if (
        !isCurrentRequest(requestId) ||
        !isCurrentScope(requestScope)
      ) return;
      if (result.succeeded.length === 1) {
        commitMessage({ ...message, isUnread: false }, requestScope);
        void refreshCurrentView();
      } else if (result.failed.length === 1) {
        setReaderError("The mail provider did not mark this message as read.");
      } else {
        setReaderError(
          "The read update could not be confirmed. Messages are being refreshed.",
        );
        void refreshCurrentView();
      }
    }
  } catch (error) {
    if (!isCurrentRequest(requestId)) return;
    if (handleSessionFailure(error)) return;
    const definiteRejection = error instanceof ApiClientError &&
      error.status >= 400 && error.status < 500;
    setReaderError(definiteRejection ? errorMessage(error) :
      "The read update could not be confirmed. Messages are being refreshed.");
    if (!definiteRejection) void refreshCurrentView();
  } finally {
    if (isCurrentRequest(requestId)) setIsReaderLoading(false);
  }
  }, [beginRequest, commitMessage, currentScope, handleSessionFailure,
    isCurrentRequest, isCurrentScope, refreshCurrentView, setIsReaderLoading,
    setReaderError]);
};
