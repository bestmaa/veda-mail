"use client";

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { mailApi } from "@/transport/client/api-client";
import {
  ignoreMailSessionFailure,
  type MailSessionFailureHandler,
} from "@/presentation/features/mail-workspace/hooks/mail-session-failure";

interface AttachmentDownloadState {
  readonly error: string | null;
  readonly href: string | null;
  readonly isDownloading: boolean;
}

const initialState: AttachmentDownloadState = {
  error: null,
  href: null,
  isDownloading: false,
};

export const useAttachmentDownload = (
  sessionScope: string,
  handleSessionFailure: MailSessionFailureHandler = ignoreMailSessionFailure,
) => {
  const active = useRef<AbortController | null>(null);
  const [state, setState] = useState(initialState);

  useLayoutEffect(() => {
    active.current?.abort();
    active.current = null;
    setState(initialState);
    return () => active.current?.abort();
  }, [sessionScope]);

  const download = useCallback(
    async (href: string, name: string): Promise<void> => {
      if (!sessionScope) return;
      active.current?.abort();
      const controller = new AbortController();
      active.current = controller;
      setState({ error: null, href, isDownloading: true });
      try {
        await mailApi.downloadAttachment(
          href,
          name,
          sessionScope,
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setState({ error: null, href, isDownloading: false });
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        if (handleSessionFailure(error)) return;
        setState({
          error:
            error instanceof Error
              ? error.message
              : "Unable to download this attachment.",
          href,
          isDownloading: false,
        });
      } finally {
        if (active.current === controller) active.current = null;
      }
    },
    [handleSessionFailure, sessionScope],
  );

  return { ...state, download };
};
