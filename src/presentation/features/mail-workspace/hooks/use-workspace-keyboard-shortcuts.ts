"use client";

import type { MessageListPreferencesViewModel } from "@/presentation/features/mail-workspace/message-list-preferences.view-model";
import type { ReaderViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";
import type { createMailListViewModel } from "@/presentation/features/mail-workspace/mail-list.view-model";
import type { useComposerModel } from "@/presentation/features/mail-workspace/hooks/use-composer-model";
import type { useMailDataModel } from "@/presentation/features/mail-workspace/hooks/use-mail-data-model";
import { useMailKeyboardShortcuts } from "@/presentation/features/mail-workspace/hooks/use-mail-keyboard-shortcuts";
import type { useWorkspacePrimaryActions } from "@/presentation/features/mail-workspace/hooks/use-workspace-primary-actions";

export const useWorkspaceKeyboardShortcuts = (
  composer: ReturnType<typeof useComposerModel>,
  isComposerReady: boolean,
  mail: ReturnType<typeof useMailDataModel>,
  mailList: ReturnType<typeof createMailListViewModel>,
  preferences: MessageListPreferencesViewModel,
  primaryActions: ReturnType<typeof useWorkspacePrimaryActions>,
  reader: ReaderViewModel | null,
) => useMailKeyboardShortcuts({
  composerOpen: composer.isOpen,
  enabled: preferences.keyboardShortcuts,
  isBusy: mail.isReaderMutating || mail.bulk.isBusy,
  isComposerReady,
  messages: mailList.messages,
  onArchive: mail.archive,
  onCloseReader: mail.closeReader,
  onCompose: primaryActions.onCompose,
  onForward: primaryActions.onForward,
  onReply: primaryActions.onReply,
  onReplyAll: primaryActions.onReplyAll,
  onToggleRead: mail.toggleRead,
  onToggleStar: mail.toggleStar,
  readerMessageId: reader?.messageId ?? null,
});
