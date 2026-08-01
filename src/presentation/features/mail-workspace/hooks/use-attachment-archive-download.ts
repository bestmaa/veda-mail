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

interface ArchiveDownloadState {
  readonly error: string | null;
  readonly href: string | null;
  readonly isPreparing: boolean;
}

const initialState: ArchiveDownloadState = {
  error: null,
  href: null,
  isPreparing: false,
};

export const useAttachmentArchiveDownload = (
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

  const download = useCallback(async (href: string): Promise<void> => {
    if (!sessionScope) return;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setState({ error: null, href, isPreparing: true });
    try {
      const downloadHref = await mailApi.preflightAttachmentArchive(
        href,
        sessionScope,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      await mailApi.downloadAttachmentArchive(
        downloadHref,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setState({ error: null, href, isPreparing: false });
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (handleSessionFailure(error)) return;
      setState({
        error:
          error instanceof Error
            ? error.message
            : "Unable to prepare these attachments.",
        href,
        isPreparing: false,
      });
    } finally {
      if (active.current === controller) active.current = null;
    }
  }, [handleSessionFailure, sessionScope]);

  return { ...state, download };
};
