"use client";

import { useCallback, useRef, useState } from "react";

import type { MailWorkspace, MessageDetail } from "@/domain/mail/mail";

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

  return {
    acceptWorkspace,
    clear,
    clearMessage: useCallback(() => setSelection(null), []),
    commitMessage,
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
