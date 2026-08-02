"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  MessageListDensity,
  MessageListPreferences,
  MessageListSort,
  UndoSendDelay,
} from "@/domain/mail/message-list-preferences";
import type {
  MessageListPreferencesViewModel,
  SaveMessageListPreferences,
} from "@/presentation/features/mail-workspace/message-list-preferences.view-model";

const same = (
  left: MessageListPreferences,
  right: MessageListPreferences,
): boolean => left.density === right.density &&
  left.showPreview === right.showPreview && left.sort === right.sort &&
  left.confirmBeforeSend === right.confirmBeforeSend &&
  left.undoSendSeconds === right.undoSendSeconds &&
  left.keyboardShortcuts === right.keyboardShortcuts;

const savedAnnouncement = (preferences: MessageListPreferences): string =>
  `Mailbox preferences saved. ${
    preferences.sort === "newest" ? "Newest" : "Oldest"
  } messages first.`;

export const useMessageListPreferencesModel = (
  current: MessageListPreferences,
  save: SaveMessageListPreferences,
): MessageListPreferencesViewModel => {
  const [draft, setDraft] = useState(current);
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const runId = useRef(0);

  useEffect(() => {
    if (!isOpen && !isSaving) setDraft(current);
  }, [current, isOpen, isSaving]);

  const onClose = useCallback(() => {
    if (isSaving) return;
    runId.current += 1;
    setDraft(current);
    setError(null);
    setIsOpen(false);
  }, [current, isSaving]);

  return {
    announcement,
    confirmBeforeSend: current.confirmBeforeSend,
    density: current.density,
    keyboardShortcuts: current.keyboardShortcuts,
    dialog: {
      confirmBeforeSend: draft.confirmBeforeSend,
      density: draft.density,
      error,
      isDirty: !same(current, draft),
      isOpen,
      isSaving,
      keyboardShortcuts: draft.keyboardShortcuts,
      onClose,
      onConfirmBeforeSendChange: useCallback((confirmBeforeSend: boolean) => {
        setDraft((value) => ({ ...value, confirmBeforeSend }));
      }, []),
      onDensityChange: useCallback((density: MessageListDensity) => {
        setDraft((value) => ({ ...value, density }));
      }, []),
      onKeyboardShortcutsChange: useCallback((keyboardShortcuts: boolean) => {
        setDraft((value) => ({ ...value, keyboardShortcuts }));
      }, []),
      onPreviewChange: useCallback((showPreview: boolean) => {
        setDraft((value) => ({ ...value, showPreview }));
      }, []),
      onSortChange: useCallback((sort: MessageListSort) => {
        setDraft((value) => ({ ...value, sort }));
      }, []),
      onSubmit: useCallback(async (event) => {
        event.preventDefault();
        if (isSaving || same(current, draft)) return;
        const requestId = ++runId.current;
        setIsSaving(true);
        setError(null);
        try {
          const saved = await save(draft);
          if (requestId !== runId.current) return;
          setDraft(saved);
          setAnnouncement(savedAnnouncement(saved));
          setIsOpen(false);
        } catch (saveError) {
          if (requestId === runId.current) {
            setError(saveError instanceof Error
              ? saveError.message
              : "Unable to save message list preferences.");
          }
        } finally {
          if (requestId === runId.current) setIsSaving(false);
        }
      }, [current, draft, isSaving, save]),
      onUndoSendSecondsChange: useCallback((undoSendSeconds: UndoSendDelay) => {
        setDraft((value) => ({ ...value, undoSendSeconds }));
      }, []),
      showPreview: draft.showPreview,
      sort: draft.sort,
      undoSendSeconds: draft.undoSendSeconds,
    },
    onOpen: useCallback(() => {
      setDraft(current);
      setError(null);
      setIsOpen(true);
    }, [current]),
    showPreview: current.showPreview,
    sort: current.sort,
    undoSendSeconds: current.undoSendSeconds,
  };
};
