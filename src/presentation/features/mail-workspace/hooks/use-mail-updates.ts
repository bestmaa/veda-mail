"use client";

import { useEffect } from "react";

import { mailUpdatesApi } from "@/transport/client/mail-updates-api";

const MIN_RETRY_MS = 1_000;
const INITIAL_FAILURE_RETRY_MS = 5_000;
const MAX_FAILURE_RETRY_MS = 60_000;

const wait = (milliseconds: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timer = window.setTimeout(done, milliseconds);
    function done() {
      signal.removeEventListener("abort", aborted);
      window.clearTimeout(timer);
      resolve();
    }
    function aborted() { done(); }
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
  });

const waitUntilVisibleAndOnline = (signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const ready = () => document.visibilityState === "visible" && navigator.onLine;
    const finish = () => {
      if (!ready() && !signal.aborted) return;
      document.removeEventListener("visibilitychange", finish);
      window.removeEventListener("online", finish);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    document.addEventListener("visibilitychange", finish);
    window.addEventListener("online", finish);
    signal.addEventListener("abort", finish, { once: true });
    finish();
  });

export const useMailUpdates = (
  refresh: () => Promise<boolean>,
  sessionScope: string,
  handleSessionFailure: (failure: unknown) => boolean,
) => {
  useEffect(() => {
    if (!sessionScope) return;
    const controller = new AbortController();
    const run = async () => {
      let failureRetryMs = INITIAL_FAILURE_RETRY_MS;
      let pendingRefresh = false;
      while (!controller.signal.aborted) {
        await waitUntilVisibleAndOnline(controller.signal);
        if (controller.signal.aborted) break;
        if (pendingRefresh) {
          pendingRefresh = false;
          await refresh();
          if (controller.signal.aborted) break;
        }
        try {
          const result = await mailUpdatesApi.wait(
            sessionScope,
            controller.signal,
          );
          failureRetryMs = INITIAL_FAILURE_RETRY_MS;
          const retryAfterMs = Math.max(MIN_RETRY_MS, result.retryAfterMs);
          if (result.mode === "poll") {
            await wait(retryAfterMs, controller.signal);
          }
          if (controller.signal.aborted) break;
          if (result.shouldRefresh) {
            if (document.visibilityState === "visible") await refresh();
            else pendingRefresh = true;
          }
          if (result.mode === "push") {
            await wait(retryAfterMs, controller.signal);
          }
        } catch (error) {
          if (controller.signal.aborted || handleSessionFailure(error)) break;
          await wait(failureRetryMs, controller.signal);
          failureRetryMs = Math.min(MAX_FAILURE_RETRY_MS, failureRetryMs * 2);
        }
      }
    };
    void run();
    return () => controller.abort();
  }, [handleSessionFailure, refresh, sessionScope]);
};
