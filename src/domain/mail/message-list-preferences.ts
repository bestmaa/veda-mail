import type { ProviderId } from "@/domain/shared/brand";

export const MESSAGE_LIST_DENSITIES = [
  "compact",
  "comfortable",
  "spacious",
] as const;

export const MESSAGE_LIST_SORTS = ["newest", "oldest"] as const;
export const UNDO_SEND_DELAYS = [0, 5, 10, 20, 30] as const;
export const MAIL_LOCALES = ["en-IN", "hi-IN", "ar"] as const;

export type MessageListDensity = (typeof MESSAGE_LIST_DENSITIES)[number];
export type MessageListSort = (typeof MESSAGE_LIST_SORTS)[number];
export type UndoSendDelay = (typeof UNDO_SEND_DELAYS)[number];
export type MailLocale = (typeof MAIL_LOCALES)[number];

export interface MessageListPreferences {
  readonly confirmBeforeSend: boolean;
  readonly density: MessageListDensity;
  readonly keyboardShortcuts: boolean;
  readonly locale: MailLocale;
  readonly showPreview: boolean;
  readonly sort: MessageListSort;
  readonly timeZone: string;
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
  locale: "en-IN",
  showPreview: true,
  sort: "newest",
  timeZone: "auto",
  undoSendSeconds: 0,
};

export const mailLocaleDirection = (locale: MailLocale): "ltr" | "rtl" =>
  locale === "ar" ? "rtl" : "ltr";

export const mailIntlLocale = (locale: MailLocale | string): string =>
  locale === "ar" ? "ar-u-nu-arab" : locale;
