import type { ProviderId } from "@/domain/shared/brand";

export const MESSAGE_LIST_DENSITIES = [
  "compact",
  "comfortable",
  "spacious",
] as const;

export const MESSAGE_LIST_SORTS = ["newest", "oldest"] as const;
export const UNDO_SEND_DELAYS = [0, 5, 10, 20, 30] as const;

export type MessageListDensity = (typeof MESSAGE_LIST_DENSITIES)[number];
export type MessageListSort = (typeof MESSAGE_LIST_SORTS)[number];
export type UndoSendDelay = (typeof UNDO_SEND_DELAYS)[number];

export interface MessageListPreferences {
  readonly confirmBeforeSend: boolean;
  readonly density: MessageListDensity;
  readonly keyboardShortcuts: boolean;
  readonly showPreview: boolean;
  readonly sort: MessageListSort;
  readonly undoSendSeconds: UndoSendDelay;
}

export interface MessageListPreferencesOwner {
  readonly email: string;
  readonly providerId: ProviderId | string;
}

export const DEFAULT_MESSAGE_LIST_PREFERENCES: MessageListPreferences = {
  confirmBeforeSend: false,
  density: "comfortable",
  keyboardShortcuts: false,
  showPreview: true,
  sort: "newest",
  undoSendSeconds: 0,
};
