"use client";

import { useCallback, useRef, useState } from "react";

import type { MailWorkspace, MessageDetail } from "@/domain/mail/mail";
import type { MessageListPreferences } from "@/domain/mail/message-list-preferences";

interface ScopedMessage {
  readonly message: MessageDetail;
  readonly sessionScope: string;
}

export const useMailSessionScopeState = () => {
  const [workspace, setWorkspace] = useState<MailWorkspace | null>(null);
  const [selection, setSelection] = useState<ScopedMessage | null>(null);
  const sessionScopeRef = useRef("");
  const sessionScope = workspace?.sessionScope ?? "";
  const selectedMessage =
    selection?.sessionScope === sessionScope ? selection.message : null;

  const acceptWorkspace = useCallback((next: MailWorkspace): boolean => {
    const scopeChanged =
      Boolean(sessionScopeRef.current) &&
      sessionScopeRef.current !== next.sessionScope;
    sessionScopeRef.current = next.sessionScope;
    setWorkspace(next);
    if (scopeChanged) setSelection(null);
    return scopeChanged;
  }, []);

  const appendWorkspace = useCallback(
    (next: MailWorkspace, expectedScope: string): boolean => {
      if (
        !expectedScope ||
        sessionScopeRef.current !== expectedScope ||
        next.sessionScope !== expectedScope
      ) {
        return false;
      }
      setWorkspace((current) => {
        if (!current || current.sessionScope !== expectedScope) return current;
        const existingIds = new Set(
          current.messages.items.map((message) => message.id),
        );
        const appended = next.messages.items.filter(
          (message) => !existingIds.has(message.id),
        );
        return {
          ...next,
          messages: {
            ...next.messages,
            items: [...current.messages.items, ...appended],
          },
        };
      });
      return true;
    },
    [],
  );

  const clear = useCallback(() => {
    sessionScopeRef.current = "";
    setWorkspace(null);
    setSelection(null);
  }, []);

  const commitMessage = useCallback(
    (message: MessageDetail, expectedScope: string): boolean => {
      if (!expectedScope || sessionScopeRef.current !== expectedScope) {
        return false;
      }
      setSelection({ message, sessionScope: expectedScope });
      return true;
    },
    [],
  );

  const commitPreferences = useCallback((
    preferences: MessageListPreferences,
    expectedScope: string,
  ): boolean => {
    if (!expectedScope || sessionScopeRef.current !== expectedScope) return false;
    setWorkspace((current) => current?.sessionScope === expectedScope
      ? { ...current, messageListPreferences: preferences }
      : current);
    return true;
  }, []);

  return {
    acceptWorkspace,
    appendWorkspace,
    clear,
    clearMessage: useCallback(() => setSelection(null), []),
    commitMessage,
    commitPreferences,
    currentScope: useCallback(() => sessionScopeRef.current, []),
    isCurrentScope: useCallback(
      (expectedScope: string) =>
        Boolean(expectedScope) && sessionScopeRef.current === expectedScope,
      [],
    ),
    selectedMessage,
    sessionScope,
    workspace,
  };
};
