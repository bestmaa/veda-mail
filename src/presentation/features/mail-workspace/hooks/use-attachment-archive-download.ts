"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { mailApi } from "@/transport/client/api-client";

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

const startNativeDownload = (href: string): void => {
  const anchor = document.createElement("a");
  anchor.download = "";
  anchor.href = href;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
};

export const useAttachmentArchiveDownload = () => {
  const active = useRef<AbortController | null>(null);
  const [state, setState] = useState(initialState);

  useEffect(
    () => () => {
      active.current?.abort();
    },
    [],
  );

  const download = useCallback(async (href: string): Promise<void> => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setState({ error: null, href, isPreparing: true });
    try {
      await mailApi.preflightAttachmentArchive(href, controller.signal);
      if (controller.signal.aborted) return;
      setState({ error: null, href, isPreparing: false });
      startNativeDownload(href);
    } catch (error) {
      if (controller.signal.aborted) return;
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
  }, []);

  return { ...state, download };
};
