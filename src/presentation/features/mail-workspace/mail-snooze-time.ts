const pad = (value: number): string => String(value).padStart(2, "0");
export const SNOOZE_MIN_DELAY_MS = 60_000;
export const SNOOZE_MAX_DELAY_MS = 366 * 24 * 60 * 60 * 1_000;

export const snoozeLocalDateTimeValue = (
  date: Date,
  timeZone?: string,
): string => timeZone
  ? zonedDateTimeValue(date, timeZone)
  : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
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

const addDays = (date: string, days: number): string => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

const zonedPresets = (now: Date, timeZone: string) => {
  const today = zonedDateTimeValue(now, timeZone).slice(0, 10);
  let laterToday = `${today}T18:00`;
  const laterInstant = zonedLocalTimeToInstant(laterToday, timeZone);
  if (!laterInstant || laterInstant.getTime() < now.getTime() + SNOOZE_MIN_DELAY_MS) {
    laterToday = zonedDateTimeValue(
      rounded(new Date(now.getTime() + 3 * 60 * 60 * 1_000)), timeZone,
    );
  }
  const dayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    .indexOf(new Intl.DateTimeFormat("en", { timeZone, weekday: "short" })
      .format(now));
  const daysToMonday = ((8 - dayIndex) % 7) || 7;
  return [
    { id: "later-today" as const, label: "Later today", value: laterToday },
    { id: "tomorrow" as const, label: "Tomorrow", value: `${addDays(today, 1)}T08:00` },
    { id: "next-monday" as const, label: "Next Monday", value: `${addDays(today, daysToMonday)}T08:00` },
  ];
};

export const snoozePresets = (now = new Date(), timeZone?: string) => {
  if (timeZone) return zonedPresets(now, timeZone);
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

export const snoozeTimeLimits = (now = new Date(), timeZone?: string) => ({
  maximum: snoozeLocalDateTimeValue(
    new Date(now.getTime() + SNOOZE_MAX_DELAY_MS), timeZone,
  ),
  minimum: snoozeLocalDateTimeValue(
    new Date(now.getTime() + SNOOZE_MIN_DELAY_MS), timeZone,
  ),
});

export const snoozeLocalTimeToIso = (
  value: string,
  now = new Date(),
  timeZone?: string,
): string | null => {
  if (timeZone) {
    return boundedZonedLocalTimeToIso(
      value, timeZone, now, SNOOZE_MIN_DELAY_MS, SNOOZE_MAX_DELAY_MS,
    );
  }
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
import {
  boundedZonedLocalTimeToIso,
  zonedDateTimeValue,
  zonedLocalTimeToInstant,
} from "@/presentation/shared/formatters/zoned-date-time";
