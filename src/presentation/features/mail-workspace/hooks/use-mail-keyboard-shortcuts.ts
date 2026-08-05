"use client";

import { useCallback, useEffect, useState } from "react";

import type { MessageItemViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";
import type { KeyboardShortcutsViewModel } from "@/presentation/features/mail-workspace/keyboard-shortcuts.view-model";
import {
  adjacentMessageIndex,
  hasOpenModalDialog,
  mailboxShortcutKey,
} from "@/presentation/features/mail-workspace/keyboard-shortcut-policy";

interface Options {
  readonly composerOpen: boolean;
  readonly enabled: boolean;
  readonly isBusy: boolean;
  readonly isComposerReady: boolean;
  readonly messages: readonly MessageItemViewModel[];
  readonly onArchive: () => void;
  readonly onCloseReader: () => void;
  readonly onCompose: () => void;
  readonly onForward: () => void;
  readonly onReply: () => void;
  readonly onReplyAll: () => void;
  readonly onToggleRead: () => void;
  readonly onToggleStar: () => void;
  readonly readerMessageId: string | null;
}

const focusMessageTrigger = (messageId: string): void => {
  [...document.querySelectorAll<HTMLElement>("[data-message-id]")]
    .find((element) => element.dataset["messageId"] === messageId)
    ?.focus();
};

export const useMailKeyboardShortcuts = (options: Options): KeyboardShortcutsViewModel => {
  const [announcement, setAnnouncement] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const close = useCallback(() => setIsOpen(false), []);
  const open = useCallback(() => setIsOpen(true), []);

  useEffect(() => {
    if (!options.enabled) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      const key = mailboxShortcutKey(event);
      if (!key || hasOpenModalDialog() || options.composerOpen) return;
      const hasReader = Boolean(options.readerMessageId);
      const readerReady = hasReader && !options.isBusy;
      const announce = (message: string): void => {
        event.preventDefault();
        setAnnouncement("");
        window.requestAnimationFrame(() => setAnnouncement(message));
      };
      if (key === "?") {
        event.preventDefault();
        open();
      } else if (key === "/") {
        const search = document.querySelector<HTMLInputElement>("[data-mail-search]");
        if (search) {
          event.preventDefault();
          search.focus();
          search.select();
        }
      } else if (key === "c" && options.isComposerReady) {
        announce("New message composer opened.");
        options.onCompose();
      } else if ((key === "j" || key === "k") && options.messages.length > 0) {
        const adjacent = adjacentMessageIndex(
          options.messages.map(({ id }) => id),
          options.readerMessageId,
          key === "j" ? "next" : "previous",
        );
        if (adjacent !== null) {
          const message = options.messages[adjacent];
          if (!message) return;
          announce(key === "j" ? "Opened next message." : "Opened previous message.");
          focusMessageTrigger(message.id);
          message.onSelect();
        }
      } else if (key === "escape" && hasReader) {
        announce("Returned to the message list.");
        options.onCloseReader();
      } else if (key === "e" && readerReady) {
        announce("Message archived.");
        options.onArchive();
      } else if (key === "s" && readerReady) {
        announce("Message star changed.");
        options.onToggleStar();
      } else if (key === "u" && readerReady) {
        announce("Message read status changed.");
        options.onToggleRead();
      } else if (key === "r" && readerReady && options.isComposerReady) {
        announce("Reply composer opened.");
        options.onReply();
      } else if (key === "a" && readerReady && options.isComposerReady) {
        announce("Reply all composer opened.");
        options.onReplyAll();
      } else if (key === "f" && readerReady && options.isComposerReady) {
        announce("Forward composer opened.");
        options.onForward();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, options]);

  return {
    announcement,
    dialog: { enabled: options.enabled, isOpen, onClose: close },
    enabled: options.enabled,
    onOpen: open,
  };
};
