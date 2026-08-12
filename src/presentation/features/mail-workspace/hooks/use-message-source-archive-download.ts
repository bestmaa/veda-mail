"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";

import { MAX_MESSAGE_SOURCE_ARCHIVE_ENTRIES } from "@/domain/mail/message-source";
import type { MessageId } from "@/domain/shared/brand";
import type { MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import { mailApi } from "@/transport/client/api-client";

export const useMessageSourceArchiveDownload = (
  sessionScope: string,
  handleSessionFailure: MailSessionFailureHandler,
) => {
  const active = useRef<AbortController | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDownloading, setDownloading] = useState(false);
  useLayoutEffect(() => {
    active.current?.abort(); active.current = null; setError(null); setDownloading(false);
    return () => active.current?.abort();
  }, [sessionScope]);
  const download = useCallback(async (messageIds: readonly MessageId[]) => {
    if (!sessionScope || !messageIds.length ||
        messageIds.length > MAX_MESSAGE_SOURCE_ARCHIVE_ENTRIES) return;
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    setError(null); setDownloading(true);
    try {
      await mailApi.downloadMessageSourceArchive(messageIds, sessionScope, controller.signal);
    } catch (reason) {
      if (controller.signal.aborted || handleSessionFailure(reason)) return;
      setError(reason instanceof Error ? reason.message : "Unable to export selected messages.");
    } finally {
      if (active.current === controller) active.current = null;
      if (!controller.signal.aborted) setDownloading(false);
    }
  }, [handleSessionFailure, sessionScope]);
  return { download, error, isDownloading };
};
