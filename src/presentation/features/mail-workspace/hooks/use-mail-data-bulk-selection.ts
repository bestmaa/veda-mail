"use client";

import { useCallback } from "react";

import type { MailWorkspace, MessageDetail } from "@/domain/mail/mail";
import type { MailboxId, MessageId } from "@/domain/shared/brand";
import type { MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import { useMailBulkSelection } from "@/presentation/features/mail-workspace/hooks/use-mail-bulk-selection";

const EMPTY_MESSAGES = [] as const;

interface MailDataBulkSelectionOptions {
  readonly activeMailboxId: MailboxId | null;
  readonly appliedSearch: string;
  readonly clearMessage: () => void;
  readonly currentViewRevision: () => number;
  readonly handleSessionFailure: MailSessionFailureHandler;
  readonly isCurrentScope: (scope: string) => boolean;
  readonly refresh: () => void;
  readonly selectedMessage: MessageDetail | null;
  readonly sessionScope: string;
  readonly workspace: MailWorkspace | null;
}

export const useMailDataBulkSelection = ({
  activeMailboxId,
  appliedSearch,
  clearMessage,
  currentViewRevision,
  handleSessionFailure,
  isCurrentScope,
  refresh,
  selectedMessage,
  sessionScope,
  workspace,
}: MailDataBulkSelectionOptions) => {
  const onSucceeded = useCallback(
    (messageIds: readonly MessageId[]) => {
      if (selectedMessage && messageIds.includes(selectedMessage.id)) {
        clearMessage();
      }
    },
    [clearMessage, selectedMessage],
  );
  return useMailBulkSelection({
    currentViewRevision,
    handleSessionFailure,
    isCurrentScope,
    messages: workspace?.messages.items ?? EMPTY_MESSAGES,
    onSucceeded,
    refresh,
    sessionScope,
    viewKey: `${activeMailboxId ?? ""}\n${appliedSearch}\n${
      workspace?.messageListPreferences.sort ?? "newest"
    }`,
  });
};
