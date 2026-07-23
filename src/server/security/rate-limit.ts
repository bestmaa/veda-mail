import "server-only";

import { createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";

import { ApiError } from "@/transport/http/api-error";

interface RateWindow {
  count: number;
  resetAt: number;
}

const globalState = globalThis as typeof globalThis & {
  __vedaMailRateLimitSalt?: Buffer;
  __vedaMailRateLimits?: Map<string, RateWindow>;
};

const windows = globalState.__vedaMailRateLimits ?? new Map<string, RateWindow>();
const salt = globalState.__vedaMailRateLimitSalt ?? randomBytes(32);
globalState.__vedaMailRateLimits = windows;
globalState.__vedaMailRateLimitSalt = salt;

const MAX_RATE_WINDOWS = 10_000;

const validIp = (value: string | null | undefined): string | null => {
  const candidate = value?.trim();
  return candidate && isIP(candidate) !== 0 ? candidate : null;
};

export const rateLimitSourceFor = (request: Request): string | null => {
  if (process.env["VEDA_MAIL_TRUST_PROXY_HEADERS"] !== "true") {
    return null;
  }
  const forwarded = request.headers
    .get("x-forwarded-for")
    ?.split(",")
    .toReversed()
    .map((value) => validIp(value))
    .find((value) => value !== null);
  return forwarded ?? validIp(request.headers.get("x-real-ip"));
};

const fingerprint = (scope: string, value: string): string =>
  createHmac("sha256", salt)
    .update(scope)
    .update("\0")
    .update(value)
    .digest("base64url");

const rateLimited = (): never => {
  throw new ApiError(
    "Too many requests. Please wait and try again.",
    "RATE_LIMITED",
    429,
  );
};

const prune = (now: number): void => {
  if (windows.size < MAX_RATE_WINDOWS) {
    return;
  }
  for (const [key, window] of windows) {
    if (window.resetAt <= now) {
      windows.delete(key);
    }
  }
};

const consume = (
  key: string,
  limit: number,
  durationMs: number,
  now: number,
): void => {
  prune(now);
  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    if (windows.size >= MAX_RATE_WINDOWS) {
      rateLimited();
    }
    windows.set(key, { count: 1, resetAt: now + durationMs });
    return;
  }
  if (current.count >= limit) {
    rateLimited();
  }
  current.count += 1;
};

export const assertRequestRateLimit = (
  request: Request,
  scope: string,
  globalLimit: number,
  trustedSourceLimit: number,
  durationMs: number,
): void => {
  const now = Date.now();
  consume(`${scope}:global`, globalLimit, durationMs, now);
  const source = rateLimitSourceFor(request);
  if (source) {
    consume(
      `${scope}:source:${fingerprint(scope, source)}`,
      trustedSourceLimit,
      durationMs,
      now,
    );
  }
};

export const assertSubjectRateLimit = (
  scope: string,
  subject: string,
  limit: number,
  durationMs: number,
): void => {
  const normalized = subject.trim();
  consume(
    `${scope}:subject:${fingerprint(scope, normalized)}`,
    limit,
    durationMs,
    Date.now(),
  );
};

const cookieValue = (request: Request, name: string): string | null => {
  const prefix = `${name}=`;
  const item = request.headers
    .get("cookie")
    ?.split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(prefix));
  if (!item) {
    return null;
  }
  try {
    return decodeURIComponent(item.slice(prefix.length));
  } catch {
    return item.slice(prefix.length);
  }
};

export const assertSessionRateLimit = (
  request: Request,
  scope: string,
  cookieName: string,
  limit: number,
  durationMs: number,
): void => {
  assertSubjectRateLimit(
    scope,
    cookieValue(request, cookieName) ?? "missing-session",
    limit,
    durationMs,
  );
};
