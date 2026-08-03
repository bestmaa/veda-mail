"use client";

import { useMemo } from "react";

import type { MessageId } from "@/domain/shared/brand";
import { createConversationViewModel } from "@/presentation/features/mail-workspace/conversation.view-model";
import type { MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import { useMessageConversation } from "@/presentation/features/mail-workspace/hooks/use-message-conversation";

export const useMessageConversationViewModel = (input: {
  readonly anchorMessageId: MessageId | null;
  readonly handleSessionFailure: MailSessionFailureHandler;
  readonly onOpen: (messageId: string) => void;
  readonly sessionScope: string;
}) => {
  const state = useMessageConversation({
    anchorMessageId: input.anchorMessageId,
    handleSessionFailure: input.handleSessionFailure,
    sessionScope: input.sessionScope,
  });

  return useMemo(() => createConversationViewModel({
    error: state.error,
    isLoading: state.isLoading,
    isLoadingMore: state.isLoadingMore,
    onLoadMore: state.loadMore,
    onOpen: input.onOpen,
    page: state.page,
    selectedMessageId: input.anchorMessageId,
  }), [
    input.anchorMessageId,
    input.onOpen,
    state.error,
    state.isLoading,
    state.isLoadingMore,
    state.loadMore,
    state.page,
  ]);
};
