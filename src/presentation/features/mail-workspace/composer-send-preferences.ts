import type { UndoSendDelay } from "@/domain/mail/message-list-preferences";

export interface ComposerSendPreferences {
  readonly confirmBeforeSend: boolean;
  readonly undoSendSeconds: UndoSendDelay;
}

export const DEFAULT_COMPOSER_SEND_PREFERENCES: ComposerSendPreferences = {
  confirmBeforeSend: false,
  undoSendSeconds: 0,
};
