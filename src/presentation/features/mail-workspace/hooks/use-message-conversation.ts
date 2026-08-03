"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ConversationPage } from "@/domain/mail/conversation";
import type { MessageId } from "@/domain/shared/brand";
import type { MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import { mailApi } from "@/transport/client/api-client";

const message = (error: unknown): string =>
  error instanceof Error ? error.message : "Unable to load this conversation.";

const appendPage = (
  current: ConversationPage,
  next: ConversationPage,
): ConversationPage => {
  const seen = new Set(current.items.map(({ id }) => id));
  return {
    ...next,
    items: [...current.items, ...next.items.filter(({ id }) => !seen.has(id))],
  };
};

export const useMessageConversation = (input: {
  readonly anchorMessageId: MessageId | null;
  readonly handleSessionFailure: MailSessionFailureHandler;
  readonly sessionScope: string;
}) => {
  const { anchorMessageId, handleSessionFailure, sessionScope } = input;
  const [page, setPage] = useState<ConversationPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [conversationAnchor, setConversationAnchor] = useState({
    id: anchorMessageId,
    scope: sessionScope,
  });
  const requestId = useRef(0);
  const loadMoreController = useRef<AbortController | null>(null);

  useEffect(() => {
    setConversationAnchor((current) => {
      if (current.scope !== sessionScope) {
        return { id: anchorMessageId, scope: sessionScope };
      }
      if (
        current.id && anchorMessageId &&
        page?.anchorMessageId === current.id &&
        page.items.some(({ id }) => id === anchorMessageId)
      ) return current;
      return current.id === anchorMessageId
        ? current : { id: anchorMessageId, scope: sessionScope };
    });
  }, [anchorMessageId, page, sessionScope]);

  useEffect(() => {
    const anchor = conversationAnchor.scope === sessionScope
      ? conversationAnchor.id : null;
    const scope = sessionScope;
    const currentRequest = ++requestId.current;
    loadMoreController.current?.abort();
    loadMoreController.current = null;
    setPage(null);
    setError(null);
    if (!anchor || !scope) {
      setIsLoading(false);
      return;
    }
    const controller = new AbortController();
    setIsLoading(true);
    void mailApi.getConversation(anchor, scope, undefined, controller.signal)
      .then((next) => {
        if (currentRequest === requestId.current) setPage(next);
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted || currentRequest !== requestId.current) {
          return;
        }
        if (!handleSessionFailure(failure)) setError(message(failure));
      })
      .finally(() => {
        if (currentRequest === requestId.current) setIsLoading(false);
      });
    return () => {
      controller.abort();
      loadMoreController.current?.abort();
      loadMoreController.current = null;
    };
  }, [conversationAnchor, handleSessionFailure, sessionScope]);

  const loadMore = useCallback(() => {
    const cursor = page?.nextCursor;
    const anchor = conversationAnchor.scope === sessionScope
      ? conversationAnchor.id : null;
    const scope = sessionScope;
    if (!cursor || !anchor || !scope || loadMoreController.current) return;
    const currentRequest = requestId.current;
    const controller = new AbortController();
    loadMoreController.current = controller;
    setIsLoadingMore(true);
    setError(null);
    void mailApi.getConversation(anchor, scope, cursor, controller.signal)
      .then((next) => {
        if (currentRequest === requestId.current) {
          setPage((current) => current ? appendPage(current, next) : next);
        }
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted || currentRequest !== requestId.current) return;
        if (!handleSessionFailure(failure)) setError(message(failure));
      })
      .finally(() => {
        if (loadMoreController.current === controller) {
          loadMoreController.current = null;
          setIsLoadingMore(false);
        }
      });
  }, [conversationAnchor, handleSessionFailure, page?.nextCursor, sessionScope]);

  return { error, isLoading, isLoadingMore, loadMore, page };
};
