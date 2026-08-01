"use client";

export type MemberSessionRevocationReason =
  | "expired"
  | "invalidated"
  | "signed-out";

export interface MemberSessionRevocation {
  readonly eventId: string;
  readonly issuedAt: number;
  readonly reason: MemberSessionRevocationReason;
  readonly sessionScope: string;
  readonly version: 1;
}

export interface MemberSessionRevocationBus {
  readonly publish: (
    sessionScope: string,
    reason: MemberSessionRevocationReason,
  ) => void;
  readonly subscribe: (
    listener: (event: MemberSessionRevocation) => void,
  ) => () => void;
}

const CHANNEL_NAME = "veda-mail:member-session-revocation:v1";
const STORAGE_KEY = "veda-mail:member-session-revocation:event";
const MAX_SEEN_EVENTS = 128;
const scopePattern = /^[A-Za-z0-9_-]{1,128}$/u;
const reasons = new Set<MemberSessionRevocationReason>([
  "expired",
  "invalidated",
  "signed-out",
]);

const parseEvent = (value: unknown): MemberSessionRevocation | null => {
  if (!value || typeof value !== "object") return null;
  const event = value as Partial<MemberSessionRevocation>;
  return event.version === 1 &&
    typeof event.eventId === "string" && event.eventId.length <= 128 &&
    typeof event.issuedAt === "number" && Number.isFinite(event.issuedAt) &&
    typeof event.reason === "string" &&
    reasons.has(event.reason as MemberSessionRevocationReason) &&
    typeof event.sessionScope === "string" &&
    scopePattern.test(event.sessionScope)
    ? event as MemberSessionRevocation
    : null;
};

const parseSerializedEvent = (value: string | null): unknown => {
  if (!value || value.length > 1_024) return null;
  try { return JSON.parse(value); } catch { return null; }
};

const noOpBus: MemberSessionRevocationBus = {
  publish: () => undefined,
  subscribe: () => () => undefined,
};

export const createBrowserMemberSessionRevocationBus = (
  browserWindow: Window,
): MemberSessionRevocationBus => {
  const listeners = new Set<(event: MemberSessionRevocation) => void>();
  const seen = new Set<string>();
  let channel: BroadcastChannel | null = null;
  try {
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(CHANNEL_NAME);
    }
  } catch {
    channel = null;
  }
  const receive = (value: unknown) => {
    const event = parseEvent(value);
    if (!event || seen.has(event.eventId)) return;
    seen.add(event.eventId);
    if (seen.size > MAX_SEEN_EVENTS) {
      const oldest = seen.values().next().value as string | undefined;
      if (oldest) seen.delete(oldest);
    }
    for (const listener of listeners) listener(event);
  };
  channel?.addEventListener("message", (event) => receive(event.data));
  browserWindow.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) receive(parseSerializedEvent(event.newValue));
  });
  return {
    publish(sessionScope, reason) {
      if (!scopePattern.test(sessionScope)) return;
      const event: MemberSessionRevocation = {
        eventId: crypto.randomUUID(),
        issuedAt: Date.now(),
        reason,
        sessionScope,
        version: 1,
      };
      seen.add(event.eventId);
      try { channel?.postMessage(event); } catch { /* fallback below */ }
      try {
        browserWindow.localStorage.setItem(STORAGE_KEY, JSON.stringify(event));
        browserWindow.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // BroadcastChannel remains the primary transport when storage is denied.
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

let browserBus: MemberSessionRevocationBus | undefined;
export const browserMemberSessionRevocationBus = (): MemberSessionRevocationBus => {
  if (browserBus) return browserBus;
  if (typeof window === "undefined") return noOpBus;
  browserBus = createBrowserMemberSessionRevocationBus(window);
  return browserBus;
};

export const publishMemberSessionRevocation = (
  sessionScope: string,
  reason: MemberSessionRevocationReason,
): void => browserMemberSessionRevocationBus().publish(sessionScope, reason);
