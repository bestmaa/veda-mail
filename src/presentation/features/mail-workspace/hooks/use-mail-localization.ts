"use client";

import { useEffect, useMemo } from "react";

import {
  mailLocaleDirection,
  type MessageListPreferences,
} from "@/domain/mail/message-list-preferences";

export interface MailLocalization {
  readonly locale: MessageListPreferences["locale"];
  readonly timeZone: string;
}

const browserTimeZone = (): string =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

export const useMailLocalization = (
  preferences: MessageListPreferences,
): MailLocalization => {
  const timeZone = useMemo(
    () => preferences.timeZone === "auto"
      ? browserTimeZone()
      : preferences.timeZone,
    [preferences.timeZone],
  );

  useEffect(() => {
    const root = document.documentElement;
    root.dataset["mailLocale"] = preferences.locale;
    root.dir = mailLocaleDirection(preferences.locale);
    return () => {
      delete root.dataset["mailLocale"];
      root.dir = "ltr";
    };
  }, [preferences.locale]);

  return { locale: preferences.locale, timeZone };
};
