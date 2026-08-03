"use client";

import { useCallback } from "react";

import type { MessageDetail } from "@/domain/mail/mail";
import type { MailboxId, MessageId } from "@/domain/shared/brand";

interface Options {
  readonly accountEmail: string;
  readonly isComposerReady: boolean;
  readonly openCompose: () => void;
  readonly openForward: (message: MessageDetail | null) => void;
  readonly openReply: (message: MessageDetail | null) => void;
  readonly openReplyAll: (message: MessageDetail | null, email: string) => void;
  readonly requestReaderMove: (
    messageId: MessageId,
    label: string,
    trigger: HTMLButtonElement,
    sourceMailboxId: MailboxId,
  ) => void;
  readonly selectedMailboxId: MailboxId | null;
  readonly selectedMessage: MessageDetail | null;
}

export const useWorkspacePrimaryActions = ({
  accountEmail,
  isComposerReady,
  openCompose,
  openForward,
  openReply,
  openReplyAll,
  requestReaderMove,
  selectedMailboxId,
  selectedMessage,
}: Options) => ({
  onCompose: useCallback(() => {
    if (isComposerReady) openCompose();
  }, [isComposerReady, openCompose]),
  onForward: useCallback(() => {
    if (isComposerReady) openForward(selectedMessage);
  }, [isComposerReady, openForward, selectedMessage]),
  onReply: useCallback(() => {
    if (isComposerReady) openReply(selectedMessage);
  }, [isComposerReady, openReply, selectedMessage]),
  onReplyAll: useCallback(() => {
    if (isComposerReady) openReplyAll(selectedMessage, accountEmail);
  }, [accountEmail, isComposerReady, openReplyAll, selectedMessage]),
  onRequestReaderMove: useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    if (!selectedMessage || !selectedMailboxId) return;
    requestReaderMove(
      selectedMessage.id,
      selectedMessage.subject.trim() || "(No subject)",
      event.currentTarget,
      selectedMailboxId,
    );
  }, [requestReaderMove, selectedMailboxId, selectedMessage]),
});
