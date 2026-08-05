import type { MailAddress } from "@/domain/mail/mail";
import { mailIntlLocale } from "@/domain/mail/message-list-preferences";

export const formatSender = (addresses: readonly MailAddress[]): string =>
  addresses[0]?.name || addresses[0]?.email || "Unknown sender";

export const formatMessageDate = (
  value: string,
  locale = "en-IN",
  timeZone?: string,
): string => {
  const date = new Date(value);
  const today = new Date();
  const dayKey = (input: Date): string => new Intl.DateTimeFormat("en-CA", {
    day: "2-digit", month: "2-digit", timeZone, year: "numeric",
  }).format(input);
  const isToday = dayKey(date) === dayKey(today);
  return new Intl.DateTimeFormat(mailIntlLocale(locale), {
    ...(isToday
      ? { hour: "2-digit", minute: "2-digit" }
      : { day: "2-digit", month: "short" }),
    timeZone,
  }).format(date);
};

export const formatFullDate = (
  value: string,
  locale = "en-IN",
  timeZone?: string,
): string =>
  new Intl.DateTimeFormat(mailIntlLocale(locale), {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "long",
    weekday: "short",
    year: "numeric",
    timeZone,
  }).format(new Date(value));

export const formatFileSize = (bytes: number, locale = "en-IN"): string => {
  if (bytes < 1024) {
    return `${new Intl.NumberFormat(mailIntlLocale(locale)).format(bytes)} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${new Intl.NumberFormat(mailIntlLocale(locale)).format(
      Math.round(bytes / 1024),
    )} KB`;
  }
  return `${new Intl.NumberFormat(mailIntlLocale(locale), {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  }).format(bytes / (1024 * 1024))} MB`;
};

export const formatMailNumber = (
  value: number,
  locale = "en-IN",
): string => new Intl.NumberFormat(mailIntlLocale(locale)).format(value);

export const initials = (value: string): string =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase())
    .join("");
