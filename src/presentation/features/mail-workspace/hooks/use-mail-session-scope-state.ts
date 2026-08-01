"use client";

import { useCallback, useState } from "react";

import type { MailWorkspace, MessageDetail } from "@/domain/mail/mail";
import type { MessageListPreferences } from "@/domain/mail/message-list-preferences";
import type { MessageId } from "@/domain/shared/brand";
import {
  OptimisticMessageState,
  type BeginOptimisticMutationInput,
  type OptimisticMutationToken,
} from "@/presentation/features/mail-workspace/optimistic-message-state";

export type { OptimisticMutationToken } from "@/presentation/features/mail-workspace/optimistic-message-state";

export const useMailSessionScopeState = () => {
  const [state] = useState(() => new OptimisticMessageState());
  const [snapshot, setSnapshot] = useState(() => state.snapshot());
  const sync = useCallback(() => setSnapshot(state.snapshot()), [state]);

  const acceptWorkspace = useCallback((
    next: MailWorkspace,
    nextViewKey = "",
  ): boolean => {
    const changed = state.acceptWorkspace(next, nextViewKey);
    sync();
    return changed;
  }, [state, sync]);
  const appendWorkspace = useCallback((
    next: MailWorkspace,
    expectedScope: string,
  ): boolean => {
    const accepted = state.appendWorkspace(next, expectedScope);
    if (accepted) sync();
    return accepted;
  }, [state, sync]);
  const beginOptimisticMutation = useCallback((
    input: BeginOptimisticMutationInput,
  ): OptimisticMutationToken | null => {
    const token = state.begin(input);
    if (token) sync();
    return token;
  }, [state, sync]);
  const settleOptimisticMutation = useCallback((
    token: OptimisticMutationToken,
    succeeded: readonly MessageId[],
    unconfirmed: readonly MessageId[] = [],
  ): boolean => {
    const settled = state.settle(token, succeeded, unconfirmed);
    if (settled) sync();
    return settled;
  }, [state, sync]);
  const markOptimisticMutationUnconfirmed = useCallback((
    token: OptimisticMutationToken,
  ): boolean => {
    const marked = state.markUnconfirmed(token);
    if (marked) sync();
    return marked;
  }, [state, sync]);
  const clear = useCallback(() => { state.clear(); sync(); }, [state, sync]);
  const clearMessage = useCallback(
    () => { state.clearMessage(); sync(); },
    [state, sync],
  );
  const commitMessage = useCallback((
    message: MessageDetail,
    expectedScope: string,
  ): boolean => {
    const committed = state.commitMessage(message, expectedScope);
    if (committed) sync();
    return committed;
  }, [state, sync]);
  const commitPreferences = useCallback((
    preferences: MessageListPreferences,
    expectedScope: string,
  ): boolean => {
    const committed = state.commitPreferences(preferences, expectedScope);
    if (committed) sync();
    return committed;
  }, [state, sync]);
  const sessionScope = snapshot.workspace?.sessionScope ?? "";

  return {
    acceptWorkspace,
    appendWorkspace,
    beginOptimisticMutation,
    clear,
    clearMessage,
    commitMessage,
    commitPreferences,
    currentMessageId: useCallback(() => state.currentMessageId(), [state]),
    currentScope: useCallback(() => state.currentScope(), [state]),
    isCurrentScope: useCallback(
      (expectedScope: string) => state.isCurrentScope(expectedScope),
      [state],
    ),
    isMessageMutationBusy: snapshot.isMessageMutationBusy,
    markOptimisticMutationUnconfirmed,
    pendingMessageIds: snapshot.pendingMessageIds,
    selectedMessage: snapshot.selectedMessage,
    sessionScope,
    settleOptimisticMutation,
    workspace: snapshot.workspace,
  };
};
