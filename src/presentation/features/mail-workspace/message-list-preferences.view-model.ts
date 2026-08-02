import type { FormEventHandler } from "react";

import type {
  MessageListDensity,
  MessageListPreferences,
  MessageListSort,
  UndoSendDelay,
} from "@/domain/mail/message-list-preferences";

export interface MessageListPreferencesViewModel {
  readonly announcement: string;
  readonly confirmBeforeSend: boolean;
  readonly density: MessageListDensity;
  readonly dialog: {
    readonly confirmBeforeSend: boolean;
    readonly density: MessageListDensity;
    readonly error: string | null;
    readonly isDirty: boolean;
    readonly isOpen: boolean;
    readonly isSaving: boolean;
    readonly keyboardShortcuts: boolean;
    readonly onClose: () => void;
    readonly onConfirmBeforeSendChange: (enabled: boolean) => void;
    readonly onDensityChange: (density: MessageListDensity) => void;
    readonly onKeyboardShortcutsChange: (enabled: boolean) => void;
    readonly onPreviewChange: (showPreview: boolean) => void;
    readonly onSortChange: (sort: MessageListSort) => void;
    readonly onSubmit: FormEventHandler<HTMLFormElement>;
    readonly onUndoSendSecondsChange: (seconds: UndoSendDelay) => void;
    readonly showPreview: boolean;
    readonly sort: MessageListSort;
    readonly undoSendSeconds: UndoSendDelay;
  };
  readonly keyboardShortcuts: boolean;
  readonly onOpen: () => void;
  readonly showPreview: boolean;
  readonly sort: MessageListSort;
  readonly undoSendSeconds: UndoSendDelay;
}

export type SaveMessageListPreferences = (
  preferences: MessageListPreferences,
) => Promise<MessageListPreferences>;
