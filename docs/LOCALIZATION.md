# Localization foundation

Veda Mail keeps locale and time-zone behavior provider independent. Each signed-
in identity receives an owner-isolated encrypted preference record; JMAP and
IMAP/SMTP accounts use the same contract.

## Current contract

- Formatting locales are `en-IN`, `hi-IN`, and `ar`. Arabic formatting requests
  Arabic-Indic digits and activates right-to-left page flow.
- `Automatic` resolves the browser's IANA time zone. A member may instead select
  any IANA zone supported by the runtime.
- Message dates, reader metadata, attachment sizes, counts, rules previews,
  scheduled send, and Snooze use the accepted locale and time zone.
- Scheduled and snoozed wall-clock values are converted to one UTC instant.
  Nonexistent daylight-saving times fail validation instead of being silently
  shifted; stored jobs remain UTC.
- Locale and time-zone input is length bounded and strictly parsed before the
  encrypted preference store is changed. Values are never sent to a provider.

## Language boundary

The current source catalog is English. The selected formatting locale is exposed
as `data-mail-locale`, while the document language remains `en` so assistive
technology does not pronounce untranslated English copy as another language.
Right-to-left layout is independently available through `dir="rtl"`. When a
translated catalog is added, translated elements must carry the matching
`lang`; root `lang` changes only after the primary surface is translated.

## Adding a locale

Add the canonical BCP 47 tag and direction to
`src/domain/mail/message-list-preferences.ts`, extend the strict schema tests,
and verify number/date output, 320 CSS-pixel reflow, keyboard focus, and both
layout directions. Translation work must cover validation, alerts, dialogs,
empty states, and destructive confirmations before claiming a translated UI.
