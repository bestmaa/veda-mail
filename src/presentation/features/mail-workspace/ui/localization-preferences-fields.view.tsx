import {
  MAIL_LOCALES,
  type MailLocale,
} from "@/domain/mail/message-list-preferences";
import type { MessageListPreferencesViewModel } from "@/presentation/features/mail-workspace/message-list-preferences.view-model";

const localeLabels = {
  ar: "العربية — Arabic",
  "en-IN": "English (India)",
  "hi-IN": "हिन्दी — Hindi",
} as const;

const browserTimeZone = (): string =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

const timeZones = (): readonly string[] => {
  const supportedValuesOf = (Intl as unknown as {
    supportedValuesOf?: (key: "timeZone") => string[];
  }).supportedValuesOf;
  const values = supportedValuesOf?.("timeZone") ?? ["UTC"];
  return [...new Set([browserTimeZone(), "UTC", ...values])].sort();
};

const mailLocale = (value: string): MailLocale =>
  MAIL_LOCALES.find((locale) => locale === value) ?? "en-IN";

export const LocalizationPreferencesFieldsView = ({
  dialog,
}: {
  readonly dialog: MessageListPreferencesViewModel["dialog"];
}) => (
  <fieldset className="mt-6 border-t border-slate-200 pt-5" disabled={dialog.isSaving}>
    <legend className="px-1 text-sm font-semibold text-slate-700">
      Language and region
    </legend>
    <label className="mt-2 block text-sm font-semibold text-slate-700">
      Formatting locale and reading direction
      <select
        className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        onChange={(event) => dialog.onLocaleChange(mailLocale(event.target.value))}
        value={dialog.locale}
      >
        {MAIL_LOCALES.map((locale) => (
          <option key={locale} value={locale}>{localeLabels[locale]}</option>
        ))}
      </select>
    </label>
    <label className="mt-4 block text-sm font-semibold text-slate-700">
      Time zone
      <select
        className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        onChange={(event) => dialog.onTimeZoneChange(event.target.value)}
        value={dialog.timeZone}
      >
        <option value="auto">Automatic ({browserTimeZone()})</option>
        {timeZones().map((timeZone) => (
          <option key={timeZone} value={timeZone}>{timeZone}</option>
        ))}
      </select>
    </label>
    <p className="mt-2 text-xs leading-5 text-slate-500">
      Dates, times, numbers, and reading direction follow this account setting.
    </p>
  </fieldset>
);
