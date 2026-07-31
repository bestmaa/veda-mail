"use client";

import { useLayoutEffect } from "react";

import {
  browserMemberSessionRevocationBus,
  type MemberSessionRevocation,
  type MemberSessionRevocationBus,
} from "@/presentation/features/mail-workspace/member-session-revocation";

const MAX_TIMER_DELAY_MS = 2_147_483_647;
export type MemberSessionExpiryScheduler = (
  callback: () => void,
  delay: number,
) => () => void;

const browserScheduler: MemberSessionExpiryScheduler = (callback, delay) => {
  const timer = window.setTimeout(callback, delay);
  return () => window.clearTimeout(timer);
};

export const scheduleMemberSessionExpiry = ({
  expiresAt,
  now,
  onExpire,
  schedule,
}: {
  readonly expiresAt: string;
  readonly now: () => number;
  readonly onExpire: () => void;
  readonly schedule: MemberSessionExpiryScheduler;
}): (() => void) => {
  let cancel: () => void = () => undefined;
  let cancelled = false;
  const arm = () => {
    if (cancelled) return;
    const expiry = Date.parse(expiresAt);
    const remaining = Number.isFinite(expiry) ? expiry - now() : 0;
    if (remaining <= 0) {
      onExpire();
      return;
    }
    cancel = schedule(arm, Math.min(remaining, MAX_TIMER_DELAY_MS));
  };
  arm();
  return () => {
    cancelled = true;
    cancel();
  };
};

export const useMemberSessionRevocation = ({
  bus = browserMemberSessionRevocationBus(),
  expiresAt,
  now = Date.now,
  onRevoke,
  schedule = browserScheduler,
  sessionScope,
}: {
  readonly bus?: MemberSessionRevocationBus;
  readonly expiresAt: string;
  readonly now?: () => number;
  readonly onRevoke: (event: MemberSessionRevocation) => void;
  readonly schedule?: MemberSessionExpiryScheduler;
  readonly sessionScope: string;
}) => {
  useLayoutEffect(() => bus.subscribe((event) => {
    if (event.sessionScope === sessionScope) onRevoke(event);
  }), [bus, onRevoke, sessionScope]);

  useLayoutEffect(() => {
    if (!sessionScope || !expiresAt) return;
    return scheduleMemberSessionExpiry({
      expiresAt,
      now,
      onExpire: () => {
        onRevoke({
          eventId: crypto.randomUUID(),
          issuedAt: now(),
          reason: "expired",
          sessionScope,
          version: 1,
        });
        bus.publish(sessionScope, "expired");
      },
      schedule,
    });
  }, [bus, expiresAt, now, onRevoke, schedule, sessionScope]);
};
