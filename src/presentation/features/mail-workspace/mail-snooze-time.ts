const pad = (value: number): string => String(value).padStart(2, "0");
export const SNOOZE_MIN_DELAY_MS = 60_000;
export const SNOOZE_MAX_DELAY_MS = 366 * 24 * 60 * 60 * 1_000;

export const snoozeLocalDateTimeValue = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
  `T${pad(date.getHours())}:${pad(date.getMinutes())}`;

const rounded = (date: Date): Date => {
  const next = new Date(date);
  next.setSeconds(0, 0);
  next.setMinutes(Math.ceil(next.getMinutes() / 5) * 5);
  return next;
};

const atLocalTime = (date: Date, days: number, hour: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  next.setHours(hour, 0, 0, 0);
  return next;
};

export const snoozePresets = (now = new Date()) => {
  let laterToday = atLocalTime(now, 0, 18);
  if (laterToday.getTime() < now.getTime() + SNOOZE_MIN_DELAY_MS) {
    laterToday = rounded(new Date(now.getTime() + 3 * 60 * 60 * 1_000));
  }
  const tomorrow = atLocalTime(now, 1, 8);
  const daysToMonday = ((8 - now.getDay()) % 7) || 7;
  const nextMonday = atLocalTime(now, daysToMonday, 8);
  return [
    { id: "later-today" as const, label: "Later today", value: snoozeLocalDateTimeValue(laterToday) },
    { id: "tomorrow" as const, label: "Tomorrow", value: snoozeLocalDateTimeValue(tomorrow) },
    { id: "next-monday" as const, label: "Next Monday", value: snoozeLocalDateTimeValue(nextMonday) },
  ];
};

export const snoozeTimeLimits = (now = new Date()) => ({
  maximum: snoozeLocalDateTimeValue(new Date(now.getTime() + SNOOZE_MAX_DELAY_MS)),
  minimum: snoozeLocalDateTimeValue(new Date(now.getTime() + SNOOZE_MIN_DELAY_MS)),
});

export const snoozeLocalTimeToIso = (
  value: string,
  now = new Date(),
): string | null => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(value)) return null;
  const resolved = new Date(value);
  const timestamp = resolved.getTime();
  if (!Number.isFinite(timestamp) || snoozeLocalDateTimeValue(resolved) !== value ||
      timestamp < now.getTime() + SNOOZE_MIN_DELAY_MS ||
      timestamp > now.getTime() + SNOOZE_MAX_DELAY_MS) return null;
  return resolved.toISOString();
};

export const snoozeBrowserTimeZone = (): string =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || "Local time";
