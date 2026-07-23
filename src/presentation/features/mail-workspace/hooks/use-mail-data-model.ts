"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEventHandler,
  type MouseEventHandler,
} from "react";

import type {
  MailWorkspace,
  MessageDetail,
  MessageMutation,
} from "@/domain/mail/mail";
import { id, type MailboxId } from "@/domain/shared/brand";
import { mailApi } from "@/transport/client/api-client";

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Something went wrong.";

type SelectedMessageMutation =
  | { readonly type: "archive" | "delete" | "restore" }
  | { readonly type: "set-read" | "set-starred"; readonly value: boolean };

export const useMailDataModel = () => {
  const [workspace, setWorkspace] = useState<MailWorkspace | null>(null);
  const [activeMailboxId, setActiveMailboxId] = useState<MailboxId | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<MessageDetail | null>(
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

  const loadWorkspace = useCallback(async (override?: {
    readonly mailboxId: MailboxId | null;
    readonly search: string;
  }) => {
    const requestId = ++workspaceRequestId.current;
    const mailboxId = override ? override.mailboxId : activeMailboxId;
    const search = override ? override.search : appliedSearch;
    setIsLoading(true);
    setError(null);
    try {
      const next = await mailApi.getWorkspace({
        ...(mailboxId ? { mailboxId } : {}),
        ...(search ? { search } : {}),
      });
      if (requestId !== workspaceRequestId.current) {
        return;
      }
      setWorkspace(next);
      if (!mailboxId) {
        const inbox =
          next.mailboxes.find((mailbox) => mailbox.role === "inbox") ??
          next.mailboxes[0];
        if (inbox) {
          setActiveMailboxId(inbox.id);
        }
      }
    } catch (nextError) {
      if (requestId === workspaceRequestId.current) {
        setError(errorMessage(nextError));
      }
    } finally {
      if (requestId === workspaceRequestId.current) {
        setIsLoading(false);
      }
    }
  }, [activeMailboxId, appliedSearch]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const refresh = useCallback(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const selectMailbox = useCallback((mailboxId: string) => {
    workspaceRequestId.current += 1;
    messageRequestId.current += 1;
    setActiveMailboxId(id.mailbox(mailboxId));
    setSelectedMessage(null);
    setReaderError(null);
  }, []);

  const selectMessage = useCallback(async (messageId: string) => {
    const typedId = id.message(messageId);
    const requestId = ++messageRequestId.current;
    setIsReaderLoading(true);
    setReaderError(null);
    try {
      const message = await mailApi.getMessage(typedId);
      if (requestId !== messageRequestId.current) {
        return;
      }
      setSelectedMessage(message);
      if (message.isUnread) {
        await mailApi.mutateMessage({
          messageId: typedId,
          type: "set-read",
          value: true,
        });
        setSelectedMessage({ ...message, isUnread: false });
        refresh();
      }
    } catch (nextError) {
      if (requestId === messageRequestId.current) {
        setReaderError(errorMessage(nextError));
      }
    } finally {
      if (requestId === messageRequestId.current) {
        setIsReaderLoading(false);
      }
    }
  }, [refresh]);

  const resetForConnectionChange = useCallback(() => {
    workspaceRequestId.current += 1;
    messageRequestId.current += 1;
    setWorkspace(null);
    setActiveMailboxId(null);
    setSelectedMessage(null);
    setSearchValue("");
    setAppliedSearch("");
    setReaderError(null);
    void loadWorkspace({ mailboxId: null, search: "" });
  }, [loadWorkspace]);

  const mutateSelected = useCallback(
    async (
      mutation: SelectedMessageMutation,
    ) => {
      if (!selectedMessage) {
        return;
      }
      setReaderError(null);
      try {
        await mailApi.mutateMessage({
          ...mutation,
          messageId: selectedMessage.id,
        } as MessageMutation);
        if (
          mutation.type === "archive" ||
          mutation.type === "delete" ||
          mutation.type === "restore"
        ) {
          setSelectedMessage(null);
        } else if (mutation.type === "set-read") {
          setSelectedMessage({
            ...selectedMessage,
            isUnread: !mutation.value,
          });
        } else if (mutation.type === "set-starred") {
          setSelectedMessage({
            ...selectedMessage,
            isStarred: mutation.value,
          });
        }
        refresh();
      } catch (nextError) {
        setReaderError(errorMessage(nextError));
      }
    },
    [refresh, selectedMessage],
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

  const archive = useCallback(() => {
    void mutateSelected({ type: "archive" });
  }, [mutateSelected]);

  const remove = useCallback(() => {
    void mutateSelected({ type: "delete" });
  }, [mutateSelected]);

  const onSearchSubmit: FormEventHandler<HTMLFormElement> = useCallback(
    (event) => {
      event.preventDefault();
      setAppliedSearch(searchValue.trim());
      setSelectedMessage(null);
    },
    [searchValue],
  );

  const onRefresh: MouseEventHandler<HTMLButtonElement> = useCallback(() => {
    refresh();
  }, [refresh]);

  return {
    activeMailboxId,
    archive,
    closeReader: useCallback(() => {
      messageRequestId.current += 1;
      setSelectedMessage(null);
      setIsReaderLoading(false);
    }, []),
    error,
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
    remove,
    resetForConnectionChange,
    searchValue,
    selectMailbox,
    selectMessage,
    selectedMessage,
    toggleRead,
    toggleStar,
    workspace,
  };
};
