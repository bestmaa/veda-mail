"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";

import type { MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import { mailApi } from "@/transport/client/api-client";

export const useMessageSourceDownload = (
  sessionScope: string,
  handleSessionFailure: MailSessionFailureHandler,
) => {
  const active = useRef<AbortController | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDownloading, setDownloading] = useState(false);

  useLayoutEffect(() => {
    active.current?.abort();
    active.current = null;
    setError(null);
    setDownloading(false);
    return () => active.current?.abort();
  }, [sessionScope]);

  const download = useCallback(async (messageId: string) => {
    if (!sessionScope || !messageId) return;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setError(null);
    setDownloading(true);
    try {
      await mailApi.downloadMessageSource(
        messageId,
        sessionScope,
        controller.signal,
      );
    } catch (reason) {
      if (controller.signal.aborted || handleSessionFailure(reason)) return;
      setError(reason instanceof Error
        ? reason.message
        : "Unable to download the original message.");
    } finally {
      if (active.current === controller) active.current = null;
      if (!controller.signal.aborted) setDownloading(false);
    }
  }, [handleSessionFailure, sessionScope]);

  return { download, error, isDownloading };
};
