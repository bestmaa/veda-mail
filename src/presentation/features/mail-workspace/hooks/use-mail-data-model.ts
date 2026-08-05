"use client";
import { useCallback, useEffect, useRef, useState, type MouseEventHandler } from "react";
import { id, type MailboxId, type MessageId } from "@/domain/shared/brand";
import type { MessageListPreferences } from "@/domain/mail/message-list-preferences";
import { isMailSessionFailure } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import { useMailMessageMutations } from "@/presentation/features/mail-workspace/hooks/use-mail-message-mutations";
import { useMailDataBulkSelection } from "@/presentation/features/mail-workspace/hooks/use-mail-data-bulk-selection";
import { useMailPagination } from "@/presentation/features/mail-workspace/hooks/use-mail-pagination";
import { useMailSessionScopeState } from "@/presentation/features/mail-workspace/hooks/use-mail-session-scope-state";
import { useMailMessageSelection } from "@/presentation/features/mail-workspace/hooks/use-mail-message-selection";
import { useMessageListPreferencesSave } from "@/presentation/features/mail-workspace/hooks/use-message-list-preferences-save";
import { useMailSearchModel } from "@/presentation/features/mail-workspace/hooks/use-mail-search-model";
import { useMailUpdates } from "@/presentation/features/mail-workspace/hooks/use-mail-updates"; import { useNewMailNotifications } from "@/presentation/features/mail-workspace/hooks/use-new-mail-notifications"; import { useMailConnectivity } from "@/presentation/features/mail-workspace/hooks/use-mail-connectivity"; import { detectNewMail } from "@/domain/mail/new-mail-notification"; import type { MailWorkspace } from "@/domain/mail/mail";
import { purgeInvalidatedSessionRecovery } from "@/presentation/features/mail-workspace/member-session-recovery";
import { mailApi } from "@/transport/client/api-client";
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : "Something went wrong.";
export const useMailDataModel = () => {
  const { acceptWorkspace, appendWorkspace, beginOptimisticMutation,
    clear: clearScope, clearMessage, commitMessage, commitPreferences,
    currentMessageId, currentScope, isCurrentScope, isMessageMutationBusy,
    markOptimisticMutationUnconfirmed, pendingMessageIds, selectedMessage,
    sessionScope, settleOptimisticMutation, workspace } = useMailSessionScopeState();
  const { listenWhileHidden, notify, view: notificationView } =
    useNewMailNotifications(workspace?.account ?? null);
  const [activeMailboxId, setActiveMailboxId] = useState<MailboxId | null>(null);
  const [isLoading, setIsLoading] = useState(true), [isReaderLoading, setIsReaderLoading] = useState(false);
  const [error, setError] = useState<string | null>(null), [readerError, setReaderError] = useState<string | null>(null);
  const connectivityRefreshRef = useRef<() => Promise<boolean>>(async () => false);
  const { markCurrent, markStale, refresh: refreshConnectivity,
    retry: retryConnectivity, view: connectivity } = useMailConnectivity(connectivityRefreshRef);
  const workspaceRequestId = useRef(0), acceptedWorkspaceRef = useRef<MailWorkspace | null>(workspace);
  const messageRequestId = useRef(0);
  const sessionInvalidated = useRef(false);
  const activeMailboxIdRef = useRef(activeMailboxId), appliedSearchRef = useRef("");
  const onSearchApplied = useCallback((nextSearch: string) => {
    workspaceRequestId.current += 1;
    appliedSearchRef.current = nextSearch;
    clearMessage();
  }, [clearMessage]);
  const search = useMailSearchModel(onSearchApplied, Boolean(workspace));
  const { appliedSearch, reset: resetSearch } = search;
  const viewKey = `${activeMailboxId ?? ""}\n${appliedSearch}\n${workspace?.messageListPreferences.sort ?? "newest"}`;
  const resetMailboxView = useCallback(() => {
    messageRequestId.current += 1;
    activeMailboxIdRef.current = null; appliedSearchRef.current = "";
    setActiveMailboxId(null);
    clearMessage();
    resetSearch();
    setReaderError(null);
    setIsReaderLoading(false);
  }, [clearMessage, resetSearch]);
  const clearAccountState = useCallback(
    (failure: unknown) => {
      const invalidatedScope = currentScope();
      sessionInvalidated.current = true;
      workspaceRequestId.current += 1;
      clearScope();
      resetMailboxView();
      setIsLoading(false);
      setError(errorMessage(failure));
      purgeInvalidatedSessionRecovery(invalidatedScope, setError);
    },
    [clearScope, currentScope, resetMailboxView],
  );
  const handleSessionFailure = useCallback(
    (failure: unknown): boolean => {
      if (!isMailSessionFailure(failure)) return false;
      if (!sessionInvalidated.current) clearAccountState(failure);
      return true;
    },
    [clearAccountState],
  );
  const pagination = useMailPagination({
    activeMailboxId, appendWorkspace, appliedSearch, currentScope,
    handleSessionFailure, workspace, workspaceRequestId,
  });
  const loadWorkspace = useCallback(
    async (override?: {
      readonly mailboxId: MailboxId | null;
      readonly preferences?: MessageListPreferences;
      readonly search: string;
    }) => {
      if (sessionInvalidated.current) return false;
      const requestId = ++workspaceRequestId.current;
      const mailboxId = override ? override.mailboxId : activeMailboxId;
      const search = override ? override.search : appliedSearch;
      setIsLoading(!override || !acceptedWorkspaceRef.current);
      setError(null);
      try {
        const requestScope = currentScope();
        const next = await mailApi.getWorkspace(
          {
            ...(mailboxId ? { mailboxId } : {}),
            ...(search ? { search } : {}),
            ...(override?.preferences ? {
              showPreview: override.preferences.showPreview,
              sort: override.preferences.sort,
            } : {}),
          },
          requestScope || undefined,
        );
        if (requestId !== workspaceRequestId.current) return false;
        const resolvedMailboxId = next.selectedMailboxId ?? mailboxId ?? (
          next.mailboxes.find((candidate) => candidate.role === "inbox") ??
          next.mailboxes[0]
        )?.id ?? null;
        const nextViewKey = `${resolvedMailboxId ?? ""}\n${search}\n${
          override?.preferences?.sort ?? next.messageListPreferences.sort
        }`;
        acceptedWorkspaceRef.current = next;
        const scopeChanged = acceptWorkspace(next, nextViewKey);
        if (scopeChanged) {
          purgeInvalidatedSessionRecovery(requestScope, setError);
          resetMailboxView();
        }
        if (resolvedMailboxId &&
            (scopeChanged || activeMailboxIdRef.current !== resolvedMailboxId)) {
          activeMailboxIdRef.current = resolvedMailboxId;
          setActiveMailboxId(resolvedMailboxId);
        }
        markCurrent();
        return true;
      } catch (nextError) {
        if (requestId === workspaceRequestId.current) {
          if (handleSessionFailure(nextError)) return false;
          if (override && acceptedWorkspaceRef.current) markStale();
          else setError(errorMessage(nextError));
        }
        return false;
      } finally {
        if (requestId === workspaceRequestId.current) {
          setIsLoading(false);
        }
      }
    },
    [acceptWorkspace, activeMailboxId, appliedSearch, currentScope,
      handleSessionFailure, markCurrent, markStale, resetMailboxView],
  );
  useEffect(() => { void loadWorkspace(); }, [loadWorkspace]);
  const refresh = useCallback(() => void loadWorkspace(), [loadWorkspace]);
  const refreshCurrentView = useCallback(() => loadWorkspace({
    mailboxId: activeMailboxIdRef.current,
    search: appliedSearchRef.current,
  }), [loadWorkspace]);
  const refreshForUpdates = useCallback(async () => {
    const previous = acceptedWorkspaceRef.current;
    const refreshed = await refreshCurrentView();
    const next = acceptedWorkspaceRef.current;
    const event = refreshed && previous && next ? detectNewMail(previous, next) : null;
    if (event) notify(event);
    return refreshed;
  }, [notify, refreshCurrentView]);
  useEffect(() => { connectivityRefreshRef.current = refreshForUpdates; }, [refreshForUpdates]);
  useMailUpdates(refreshConnectivity, sessionScope, handleSessionFailure,
    listenWhileHidden, markStale);
  const beginMessageMutation = useCallback((
    input: Parameters<typeof beginOptimisticMutation>[0],
  ) => {
    const token = beginOptimisticMutation(input);
    if (token) workspaceRequestId.current += 1;
    return token;
  }, [beginOptimisticMutation]);
  const saveListPreferences = useMessageListPreferencesSave({ activeMailboxId,
    appliedSearch, commitPreferences, current: workspace?.messageListPreferences,
    currentScope, handleSessionFailure, isCurrentScope, loadWorkspace });
  const bulk = useMailDataBulkSelection({
    activeMailboxId,
    appliedSearch,
    beginOptimisticMutation: beginMessageMutation,
    currentViewRevision: () => workspaceRequestId.current,
    handleSessionFailure,
    isCurrentScope,
    markOptimisticMutationUnconfirmed,
    optimisticPendingIds: pendingMessageIds,
    refresh: refreshCurrentView,
    sessionScope,
    settleOptimisticMutation,
    workspace,
  });
  const selectMailbox = useCallback(
    (mailboxId: string) => {
      workspaceRequestId.current += 1;
      messageRequestId.current += 1;
      const nextMailboxId = id.mailbox(mailboxId);
      activeMailboxIdRef.current = nextMailboxId;
      setActiveMailboxId(nextMailboxId);
      clearMessage();
      setReaderError(null);
    },
    [clearMessage],
  );
  const selectMessage = useMailMessageSelection({
    beginRequest: () => ++messageRequestId.current,
    commitMessage, currentScope, handleSessionFailure,
    isCurrentRequest: (requestId) => requestId === messageRequestId.current,
    isCurrentScope, refreshCurrentView,
    setIsReaderLoading, setReaderError });
  const mutations = useMailMessageMutations({
    activeMailboxId,
    beginOptimisticMutation: beginMessageMutation,
    clearMessage,
    currentMessageId,
    currentViewRevision: () => workspaceRequestId.current,
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
  });
  const onRefresh: MouseEventHandler<HTMLButtonElement> = useCallback(
    () => retryConnectivity(), [retryConnectivity]);
  return {
    activeMailboxId,
    archive: mutations.archive,
    bulk,
    closeReader: useCallback(() => {
      messageRequestId.current += 1; clearMessage();
      setIsReaderLoading(false);
    }, [clearMessage]),
    connectivity, error, hasActiveSearch: Boolean(appliedSearch),
    handleSessionFailure,
    isLoading, isLoadingMore: pagination.isLoadingMore,
    isReaderLoading, isReaderMutating: mutations.isBusy || isMessageMutationBusy,
    onRefresh, onLoadMore: pagination.onLoadMore,
    onSearchClear: search.clear, onSearchInput: search.onInput,
    onSearchSubmit: search.onSubmit,
    readerError, loadMoreError: pagination.loadMoreError,
    refresh,
    remove: mutations.remove, destroy: mutations.destroy,
    restore: mutations.restore, search: search.viewModel,
    searchMaxLength: search.maxLength, searchValue: search.inputValue,
    saveListPreferences, setLabel: mutations.setLabel,
    sessionScope,
    snoozeOptimistic: {
      begin: (messageIds: readonly MessageId[], destinationMailboxId: MailboxId) => activeMailboxId ? beginMessageMutation({ activeMailboxId, mutation: { destinationMailboxId, messageIds, sourceMailboxId: activeMailboxId, type: "move" }, sessionScope, viewKey }) : null,
      markUnconfirmed: markOptimisticMutationUnconfirmed,
      settle: settleOptimisticMutation,
    },
    pendingMessageIds, notifications: notificationView,
    selectMailbox, selectMessage, selectedMessage,
    toggleRead: mutations.toggleRead, toggleStar: mutations.toggleStar,
    viewKey, workspace,
  };
};
