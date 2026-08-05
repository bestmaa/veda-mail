"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  nextConnectivityAfterFailure,
  nextConnectivityAfterSuccess,
  type MailConnectivityPhase,
} from "@/presentation/features/mail-workspace/mail-connectivity";

const RESTORED_NOTICE_MS = 5_000;
const browserIsOnline = (): boolean =>
  typeof navigator === "undefined" || navigator.onLine;

export const useMailConnectivity = (
  refreshRef: Readonly<{ current: () => Promise<boolean> }>,
) => {
  const [phase, setPhase] = useState<MailConnectivityPhase>("current");
  const refreshInFlight = useRef<Promise<boolean> | null>(null);
  const markCurrent = useCallback(() => {
    setPhase((current) => nextConnectivityAfterSuccess(current));
  }, []);
  const markStale = useCallback(() => {
    setPhase(nextConnectivityAfterFailure(browserIsOnline()));
  }, []);
  const refresh = useCallback((): Promise<boolean> => {
    if (refreshInFlight.current) return refreshInFlight.current;
    const request = refreshRef.current().finally(() => {
      if (refreshInFlight.current === request) refreshInFlight.current = null;
    });
    refreshInFlight.current = request;
    return request;
  }, [refreshRef]);
  const retry = useCallback(() => {
    if (!browserIsOnline()) {
      setPhase("offline");
      return;
    }
    setPhase("reconnecting");
    void refresh();
  }, [refresh]);
  useEffect(() => {
    const offline = () => setPhase("offline");
    const online = () => retry();
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    if (!browserIsOnline()) offline();
    return () => {
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
    };
  }, [retry]);
  useEffect(() => {
    if (phase !== "restored") return;
    const timer = window.setTimeout(() => setPhase("current"), RESTORED_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);
  const view = {
    canRetry: phase === "stale",
    isBusy: phase === "reconnecting",
    message: {
      current: "",
      offline: "You're offline. Mail shown below may be out of date.",
      reconnecting: "Back online. Checking for new mail…",
      restored: "Back online. Mail is up to date.",
      stale: "Mail may be out of date. Check your connection and retry.",
    }[phase],
    onRetry: retry,
    phase: phase === "current" ? null : phase,
  };
  return { markCurrent, markStale, refresh, retry, view };
};
