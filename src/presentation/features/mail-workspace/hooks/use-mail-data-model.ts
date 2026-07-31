"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEventHandler,
  type MouseEventHandler,
} from "react";

import { id, type MailboxId } from "@/domain/shared/brand";
import { isMailSessionFailure } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import { useMailMessageMutations } from "@/presentation/features/mail-workspace/hooks/use-mail-message-mutations";
import { useMailSessionScopeState } from "@/presentation/features/mail-workspace/hooks/use-mail-session-scope-state";
import { mailApi } from "@/transport/client/api-client";

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Something went wrong.";

export const useMailDataModel = () => {
  const {
    acceptWorkspace,
    clear: clearScope,
    clearMessage,
    commitMessage,
    currentScope,
    isCurrentScope,
    selectedMessage,
    sessionScope,
    workspace,
  } = useMailSessionScopeState();
  const [activeMailboxId, setActiveMailboxId] = useState<MailboxId | null>(
    null,
  );
  const [searchValue, setSearchValue] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isReaderLoading, setIsReaderLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readerError, setReaderError] = useState<string | null>(null);
  const workspaceRequestId = useRef(0);
  const messageRequestId = useRef(0);
  const sessionInvalidated = useRef(false);
  const resetMailboxView = useCallback(() => {
    messageRequestId.current += 1;
    setActiveMailboxId(null);
    clearMessage();
    setSearchValue("");
    setAppliedSearch("");
    setReaderError(null);
    setIsReaderLoading(false);
  }, [clearMessage]);
  const clearAccountState = useCallback(
    (failure: unknown) => {
      sessionInvalidated.current = true;
      workspaceRequestId.current += 1;
      clearScope();
      resetMailboxView();
      setIsLoading(false);
      setError(errorMessage(failure));
    },
    [clearScope, resetMailboxView],
  );
  const handleSessionFailure = useCallback(
    (failure: unknown): boolean => {
      if (!isMailSessionFailure(failure)) return false;
      if (!sessionInvalidated.current) clearAccountState(failure);
      return true;
    },
    [clearAccountState],
  );

  const loadWorkspace = useCallback(
    async (override?: {
      readonly mailboxId: MailboxId | null;
      readonly search: string;
    }) => {
      if (sessionInvalidated.current) return;
      const requestId = ++workspaceRequestId.current;
      const mailboxId = override ? override.mailboxId : activeMailboxId;
      const search = override ? override.search : appliedSearch;
      setIsLoading(true);
      setError(null);
      try {
        const requestScope = currentScope();
        const next = await mailApi.getWorkspace(
          {
            ...(mailboxId ? { mailboxId } : {}),
            ...(search ? { search } : {}),
          },
          requestScope || undefined,
        );
        if (requestId !== workspaceRequestId.current) {
          return;
        }
        const scopeChanged = acceptWorkspace(next);
        if (scopeChanged) resetMailboxView();
        if (!mailboxId || scopeChanged) {
          const inbox =
            next.mailboxes.find((mailbox) => mailbox.role === "inbox") ??
            next.mailboxes[0];
          if (inbox) {
            setActiveMailboxId(inbox.id);
          }
        }
      } catch (nextError) {
        if (requestId === workspaceRequestId.current) {
          if (handleSessionFailure(nextError)) return;
          else setError(errorMessage(nextError));
        }
      } finally {
        if (requestId === workspaceRequestId.current) {
          setIsLoading(false);
        }
      }
    },
    [
      acceptWorkspace,
      activeMailboxId,
      appliedSearch,
      currentScope,
      handleSessionFailure,
      resetMailboxView,
    ],
  );

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const refresh = useCallback(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const selectMailbox = useCallback(
    (mailboxId: string) => {
      workspaceRequestId.current += 1;
      messageRequestId.current += 1;
      setActiveMailboxId(id.mailbox(mailboxId));
      clearMessage();
      setReaderError(null);
    },
    [clearMessage],
  );

  const selectMessage = useCallback(
    async (messageId: string) => {
      const requestScope = currentScope();
      if (!requestScope) return;
      const typedId = id.message(messageId);
      const requestId = ++messageRequestId.current;
      setIsReaderLoading(true);
      setReaderError(null);
      try {
        const message = await mailApi.getMessage(typedId, requestScope);
        if (
          requestId !== messageRequestId.current ||
          !commitMessage(message, requestScope)
        ) {
          return;
        }
        if (message.isUnread) {
          await mailApi.mutateMessage(
            { messageId: typedId, type: "set-read", value: true },
            requestScope,
          );
          if (
            requestId !== messageRequestId.current ||
            !isCurrentScope(requestScope)
          )
            return;
          commitMessage({ ...message, isUnread: false }, requestScope);
          refresh();
        }
      } catch (nextError) {
        if (requestId === messageRequestId.current) {
          if (handleSessionFailure(nextError)) return;
          else setReaderError(errorMessage(nextError));
        }
      } finally {
        if (requestId === messageRequestId.current) {
          setIsReaderLoading(false);
        }
      }
    },
    [commitMessage, currentScope, handleSessionFailure, isCurrentScope, refresh],
  );

  const mutations = useMailMessageMutations({
    clearMessage,
    commitMessage,
    handleSessionFailure,
    isCurrentScope,
    refresh,
    selectedMessage,
    sessionScope,
    setReaderError,
  });

  const onSearchSubmit: FormEventHandler<HTMLFormElement> = useCallback(
    (event) => {
      event.preventDefault();
      setAppliedSearch(searchValue.trim());
      clearMessage();
    },
    [clearMessage, searchValue],
  );

  const onRefresh: MouseEventHandler<HTMLButtonElement> = useCallback(() => {
    refresh();
  }, [refresh]);

  return {
    activeMailboxId,
    archive: mutations.archive,
    closeReader: useCallback(() => {
      messageRequestId.current += 1;
      clearMessage();
      setIsReaderLoading(false);
    }, [clearMessage]),
    error,
    handleSessionFailure,
    isLoading,
    isReaderLoading,
    onRefresh,
    onSearchClear: useCallback(() => {
      setSearchValue("");
      setAppliedSearch("");
    }, []),
    onSearchInput: useCallback(
      (event: React.ChangeEvent<HTMLInputElement>) =>
        setSearchValue(event.target.value),
      [],
    ),
    onSearchSubmit,
    readerError,
    refresh,
    remove: mutations.remove,
    searchValue,
    sessionScope,
    selectMailbox,
    selectMessage,
    selectedMessage,
    toggleRead: mutations.toggleRead,
    toggleStar: mutations.toggleStar,
    workspace,
  };
};
