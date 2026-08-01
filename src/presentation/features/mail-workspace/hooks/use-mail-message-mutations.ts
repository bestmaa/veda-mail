"use client";

import {
  useCallback,
  type Dispatch,
  type SetStateAction,
} from "react";

import type { MessageDetail, MessageMutation } from "@/domain/mail/mail";
import type { LabelId } from "@/domain/shared/brand";
import type { MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import { mailApi } from "@/transport/client/api-client";

type SelectedMessageMutation =
  | { readonly type: "archive" | "delete" | "restore" }
  | { readonly type: "set-read" | "set-starred"; readonly value: boolean }
  | { readonly labelId: LabelId; readonly type: "set-label"; readonly value: boolean };

interface MailMessageMutationOptions {
  readonly clearMessage: () => void;
  readonly commitMessage: (
    message: MessageDetail,
    expectedScope: string,
  ) => boolean;
  readonly handleSessionFailure: MailSessionFailureHandler;
  readonly isCurrentScope: (expectedScope: string) => boolean;
  readonly refresh: () => void;
  readonly selectedMessage: MessageDetail | null;
  readonly sessionScope: string;
  readonly setReaderError: Dispatch<SetStateAction<string | null>>;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Something went wrong.";

export const useMailMessageMutations = ({
  clearMessage,
  commitMessage,
  handleSessionFailure,
  isCurrentScope,
  refresh,
  selectedMessage,
  sessionScope,
  setReaderError,
}: MailMessageMutationOptions) => {
  const mutateSelected = useCallback(
    async (mutation: SelectedMessageMutation) => {
      if (!selectedMessage || !sessionScope) return;
      setReaderError(null);
      try {
        await mailApi.mutateMessage(
          { ...mutation, messageId: selectedMessage.id } as MessageMutation,
          sessionScope,
        );
        if (!isCurrentScope(sessionScope)) return;
        if (
          mutation.type === "archive" ||
          mutation.type === "delete" ||
          mutation.type === "restore"
        ) {
          clearMessage();
        } else if (mutation.type === "set-read") {
          commitMessage(
            { ...selectedMessage, isUnread: !mutation.value },
            sessionScope,
          );
        } else if (mutation.type === "set-starred") {
          commitMessage(
            { ...selectedMessage, isStarred: mutation.value },
            sessionScope,
          );
        } else if (mutation.type === "set-label") {
          const currentIds = selectedMessage.labelIds ?? [];
          const nextIds = mutation.value
            ? [...new Set([...currentIds, mutation.labelId])]
            : currentIds.filter((labelId) => labelId !== mutation.labelId);
          commitMessage({ ...selectedMessage, labelIds: nextIds }, sessionScope);
        }
        refresh();
      } catch (nextError) {
        if (!isCurrentScope(sessionScope)) return;
        if (handleSessionFailure(nextError)) return;
        else setReaderError(errorMessage(nextError));
      }
    },
    [
      clearMessage,
      commitMessage,
      handleSessionFailure,
      isCurrentScope,
      refresh,
      selectedMessage,
      sessionScope,
      setReaderError,
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
    setLabel: useCallback(
      (labelId: LabelId, value: boolean) =>
        void mutateSelected({ labelId, type: "set-label", value }),
      [mutateSelected],
    ),
    toggleRead,
    toggleStar,
  };
};
