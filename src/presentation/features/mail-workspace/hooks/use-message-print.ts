"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { MessagePrintDocument, MessagePrintScope } from "@/domain/mail/message-print";
import type { MailLocale } from "@/domain/mail/message-list-preferences";
import type { MessageId } from "@/domain/shared/brand";
import type { MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import type { MessagePrintViewModel } from "@/presentation/features/mail-workspace/message-print.view-model";
import { messagePrintApi } from "@/transport/client/message-print-api";

const failureMessage = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : "Unable to prepare this print view.";

export const useMessagePrint = (input: {
  readonly anchorMessageId: MessageId | null;
  readonly conversationTotal: number;
  readonly handleSessionFailure: MailSessionFailureHandler;
  readonly locale: MailLocale;
  readonly sessionScope: string;
  readonly timeZone: string;
}): MessagePrintViewModel => {
  const {
    anchorMessageId,
    conversationTotal,
    handleSessionFailure,
    locale,
    sessionScope,
    timeZone,
  } = input;
  const [document, setDocument] = useState<MessagePrintDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const requestRevision = useRef(0);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    requestRevision.current += 1;
    controller.current?.abort();
    controller.current = null;
    setDocument(null);
    setError(null);
    setIsPreparing(false);
  }, [anchorMessageId, sessionScope]);

  const prepare = useCallback((scope: MessagePrintScope): void => {
    const messageId = anchorMessageId;
    if (!messageId || !sessionScope || controller.current) return;
    const revision = ++requestRevision.current;
    const nextController = new AbortController();
    controller.current = nextController;
    setDocument(null);
    setError(null);
    setIsPreparing(true);
    void messagePrintApi.create(
      messageId,
      scope,
      sessionScope,
      nextController.signal,
    ).then((nextDocument) => {
      if (revision === requestRevision.current) setDocument(nextDocument);
    }).catch((failure: unknown) => {
      if (nextController.signal.aborted || revision !== requestRevision.current) {
        return;
      }
      if (!handleSessionFailure(failure)) {
        setError(failureMessage(failure));
      }
    }).finally(() => {
      if (controller.current === nextController) controller.current = null;
      if (revision === requestRevision.current) setIsPreparing(false);
    });
  }, [
    anchorMessageId,
    handleSessionFailure,
    sessionScope,
  ]);
  const onPrinted = useCallback(() => setDocument(null), []);

  return {
    canPrintConversation: conversationTotal > 1,
    document,
    error,
    isPreparing,
    locale,
    onPrintConversation: () => prepare("conversation"),
    onPrintMessage: () => prepare("message"),
    onPrinted,
    timeZone,
  };
};
