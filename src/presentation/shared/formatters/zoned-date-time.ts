const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u;

const part = (
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): string => parts.find((candidate) => candidate.type === type)?.value ?? "";

export const zonedDateTimeValue = (date: Date, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  return `${part(parts, "year")}-${part(parts, "month")}-${part(parts, "day")}` +
    `T${part(parts, "hour")}:${part(parts, "minute")}`;
};

const localEpoch = (value: string): number | null => {
  const match = LOCAL_DATE_TIME.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const epoch = Date.UTC(year!, month! - 1, day, hour, minute);
  const canonical = new Date(epoch).toISOString().slice(0, 16);
  return canonical === value ? epoch : null;
};

export const zonedLocalTimeToInstant = (
  value: string,
  timeZone: string,
): Date | null => {
  const target = localEpoch(value);
  if (target === null) return null;
  let candidate = target;
  try {
    for (let iteration = 0; iteration < 4; iteration += 1) {
      const represented = localEpoch(zonedDateTimeValue(
        new Date(candidate), timeZone,
      ));
      if (represented === null) return null;
      const adjustment = target - represented;
      candidate += adjustment;
      if (adjustment === 0) break;
    }
    const resolved = new Date(candidate);
    return zonedDateTimeValue(resolved, timeZone) === value ? resolved : null;
  } catch {
    return null;
  }
};

export const boundedZonedLocalTimeToIso = (
  value: string,
  timeZone: string,
  now: Date,
  minimumDelayMs: number,
  maximumDelayMs: number,
): string | null => {
  const resolved = zonedLocalTimeToInstant(value, timeZone);
  const timestamp = resolved?.getTime() ?? Number.NaN;
  return Number.isFinite(timestamp) &&
    timestamp >= now.getTime() + minimumDelayMs &&
    timestamp <= now.getTime() + maximumDelayMs
    ? resolved!.toISOString()
    : null;
};
