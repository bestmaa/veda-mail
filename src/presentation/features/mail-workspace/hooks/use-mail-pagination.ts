"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import type { MailWorkspace } from "@/domain/mail/mail";
import type { MailboxId } from "@/domain/shared/brand";
import type { MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import { mailApi } from "@/transport/client/api-client";

interface MailPaginationOptions {
  readonly activeMailboxId: MailboxId | null;
  readonly appendWorkspace: (
    workspace: MailWorkspace,
    expectedScope: string,
  ) => boolean;
  readonly appliedSearch: string;
  readonly currentScope: () => string;
  readonly handleSessionFailure: MailSessionFailureHandler;
  readonly workspace: MailWorkspace | null;
  readonly workspaceRequestId: RefObject<number>;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Something went wrong.";

export const useMailPagination = ({
  activeMailboxId,
  appendWorkspace,
  appliedSearch,
  currentScope,
  handleSessionFailure,
  workspace,
  workspaceRequestId,
}: MailPaginationOptions) => {
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const requestId = useRef(0);
  const loading = useRef(false);
  const sessionScope = workspace?.sessionScope ?? "";
  const preferences = workspace?.messageListPreferences;

  useEffect(() => {
    requestId.current += 1;
    loading.current = false;
    setIsLoadingMore(false);
    setLoadMoreError(null);
  }, [activeMailboxId, appliedSearch, preferences?.showPreview,
    preferences?.sort, sessionScope]);

  const onLoadMore = useCallback(async () => {
    const cursor = workspace?.messages.nextCursor;
    const requestScope = currentScope();
    if (!cursor || !requestScope || loading.current) return;
    const rootRequestId = workspaceRequestId.current;
    const pageRequestId = ++requestId.current;
    loading.current = true;
    setIsLoadingMore(true);
    setLoadMoreError(null);
    try {
      const next = await mailApi.getWorkspace(
        {
          cursor,
          ...(activeMailboxId ? { mailboxId: activeMailboxId } : {}),
          ...(appliedSearch ? { search: appliedSearch } : {}),
          ...(preferences ? {
            showPreview: preferences.showPreview,
            sort: preferences.sort,
          } : {}),
        },
        requestScope,
      );
      if (
        pageRequestId !== requestId.current ||
        rootRequestId !== workspaceRequestId.current
      ) return;
      appendWorkspace(next, requestScope);
    } catch (error) {
      if (
        pageRequestId === requestId.current &&
        rootRequestId === workspaceRequestId.current
      ) {
        if (handleSessionFailure(error)) return;
        setLoadMoreError(errorMessage(error));
      }
    } finally {
      if (pageRequestId === requestId.current) {
        loading.current = false;
        setIsLoadingMore(false);
      }
    }
  }, [
    activeMailboxId,
    appliedSearch,
    appendWorkspace,
    currentScope,
    handleSessionFailure,
    preferences,
    workspace?.messages.nextCursor,
    workspaceRequestId,
  ]);

  return { isLoadingMore, loadMoreError, onLoadMore };
};
