import {
  boundedZonedLocalTimeToIso,
  zonedDateTimeValue,
} from "@/presentation/shared/formatters/zoned-date-time";

const pad = (value: number): string => String(value).padStart(2, "0");

export const localDateTimeValue = (date: Date, timeZone?: string): string =>
  timeZone
    ? zonedDateTimeValue(date, timeZone)
    : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
      `T${pad(date.getHours())}:${pad(date.getMinutes())}`;

export const defaultScheduledLocalTime = (
  now = new Date(),
  timeZone?: string,
): string => {
  const next = new Date(now.getTime() + 60 * 60 * 1_000);
  next.setSeconds(0, 0);
  next.setMinutes(Math.ceil(next.getMinutes() / 5) * 5);
  return localDateTimeValue(next, timeZone);
};

export const scheduledLocalTimeToIso = (
  value: string,
  now = new Date(),
  timeZone?: string,
): string | null => {
  if (timeZone) {
    return boundedZonedLocalTimeToIso(
      value, timeZone, now, 5_000, 366 * 24 * 60 * 60 * 1_000,
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(value)) return null;
  const resolved = new Date(value);
  const timestamp = resolved.getTime();
  if (
    !Number.isFinite(timestamp) ||
    localDateTimeValue(resolved) !== value ||
    timestamp < now.getTime() + 5_000 ||
    timestamp > now.getTime() + 366 * 24 * 60 * 60 * 1_000
  ) {
    return null;
  }
  return resolved.toISOString();
};

export const browserTimeZone = (): string =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || "Local time";
