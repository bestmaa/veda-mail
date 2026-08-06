import "server-only";

export type LogLevel = "error" | "info" | "warn";
export type LogOutcome = "error" | "success";

export interface StructuredLogFields {
  readonly count?: number;
  readonly durationMs?: number;
  readonly errorType?: string;
  readonly method?: string;
  readonly operation?: string;
  readonly outcome?: LogOutcome;
  readonly providerId?: string;
  readonly requestId?: string;
  readonly route?: string;
  readonly statusCode?: number;
}

const TOKEN_PATTERN = /^[A-Za-z0-9_.:-]{1,80}$/u;
const EVENT_PATTERN = /^[a-z0-9_.-]{1,80}$/u;
const METHOD_PATTERN = /^[A-Z]{3,10}$/u;
const PUBLIC_ROUTE_SEGMENTS = new Set([
  "account", "admin", "api", "archive", "attachments", "auth", "branding", "bulk",
  "calendar", "capabilities", "capability", "contacts", "conversation",
  "delivery-notices", "drafts", "empty", "health", "ics", "imports",
  "inline-image", "labels", "logo", "mail", "mail-policy", "mail-service",
  "mailboxes", "member", "messages", "metrics", "organization",
  "preferences", "preview", "providers", "ready", "reconcile", "respond", "restore",
  "retry", "rules", "scheduled", "send", "session", "settings", "setup",
  "signatures", "snoozed", "templates", "two-factor", "updates", "users",
  "v1", "vcard", "workspace",
]);
const DYNAMIC_COLLECTION_SEGMENTS = new Set([
  "delivery-notices",
  "drafts",
  "scheduled",
  "snoozed",
  "users",
]);

const safeNumber = (value: number | undefined): number | undefined =>
  value !== undefined && Number.isFinite(value) && value >= 0
    ? Math.round(value * 100) / 100
    : undefined;

const safeToken = (value: string | undefined): string | undefined =>
  value && TOKEN_PATTERN.test(value) ? value : undefined;

const safeRoute = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const route = value.split(/[?#]/u, 1)[0] ?? "";
  if (!route.startsWith("/") || route.length > 160) return undefined;
  if (route === "/") return route;
  const segments = route.split("/");
  return segments
    .map((segment, index) => {
      const previous = segments[index - 1];
      const isDynamic =
        DYNAMIC_COLLECTION_SEGMENTS.has(previous ?? "") ||
        (previous === "messages" && segment !== "bulk") ||
        (previous === "attachments" &&
          segment !== "archive" &&
          segment !== "capability");
      return index === 0 || (!isDynamic && PUBLIC_ROUTE_SEGMENTS.has(segment))
        ? segment
        : ":id";
    })
    .join("/");
};

export const safeErrorType = (error: unknown): string => {
  if (error instanceof Error) return safeToken(error.name) ?? "Error";
  return "UnknownError";
};

const sanitizeFields = (fields: StructuredLogFields) => ({
  ...(safeNumber(fields.count) === undefined
    ? {}
    : { count: safeNumber(fields.count) }),
  ...(safeNumber(fields.durationMs) === undefined
    ? {}
    : { durationMs: safeNumber(fields.durationMs) }),
  ...(safeToken(fields.errorType)
    ? { errorType: safeToken(fields.errorType) }
    : {}),
  ...(fields.method && METHOD_PATTERN.test(fields.method)
    ? { method: fields.method }
    : {}),
  ...(safeToken(fields.operation)
    ? { operation: safeToken(fields.operation) }
    : {}),
  ...(fields.outcome ? { outcome: fields.outcome } : {}),
  ...(safeToken(fields.providerId)
    ? { providerId: safeToken(fields.providerId) }
    : {}),
  ...(safeToken(fields.requestId)
    ? { requestId: safeToken(fields.requestId) }
    : {}),
  ...(safeRoute(fields.route) ? { route: safeRoute(fields.route) } : {}),
  ...(safeNumber(fields.statusCode) === undefined
    ? {}
    : { statusCode: safeNumber(fields.statusCode) }),
});

export const writeStructuredLog = (
  level: LogLevel,
  event: string,
  fields: StructuredLogFields = {},
): void => {
  const safeEvent = EVENT_PATTERN.test(event) ? event : "invalid_event";
  const entry = JSON.stringify({
    event: safeEvent,
    level,
    service: "veda-mail",
    timestamp: new Date().toISOString(),
    ...sanitizeFields(fields),
  });
  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else console.info(entry);
};

export const logError = (event: string, fields?: StructuredLogFields) =>
  writeStructuredLog("error", event, fields);
export const logInfo = (event: string, fields?: StructuredLogFields) =>
  writeStructuredLog("info", event, fields);
export const logWarn = (event: string, fields?: StructuredLogFields) =>
  writeStructuredLog("warn", event, fields);
