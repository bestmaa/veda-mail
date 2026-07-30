"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { mailApi } from "@/transport/client/api-client";

interface AttachmentPreviewState {
  readonly error: string | null;
  readonly href: string | null;
  readonly isLoading: boolean;
  readonly isOpen: boolean;
  readonly name: string;
  readonly url: string | null;
}

const initialState: AttachmentPreviewState = {
  error: null,
  href: null,
  isLoading: false,
  isOpen: false,
  name: "",
  url: null,
};

export const useAttachmentPreview = () => {
  const active = useRef<AbortController | null>(null);
  const activeUrl = useRef<string | null>(null);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const [state, setState] = useState(initialState);

  const revokeUrl = useCallback(() => {
    if (!activeUrl.current) return;
    URL.revokeObjectURL(activeUrl.current);
    activeUrl.current = null;
  }, []);

  useEffect(() => {
    return () => {
      active.current?.abort();
      revokeUrl();
    };
  }, [revokeUrl]);

  const close = useCallback(() => {
    active.current?.abort();
    active.current = null;
    revokeUrl();
    setState(initialState);
  }, [revokeUrl]);

  const restoreFocus = useCallback(() => {
    if (returnFocus.current?.isConnected) returnFocus.current.focus();
    returnFocus.current = null;
  }, []);

  const open = useCallback(async (
    href: string,
    name: string,
    trigger: HTMLButtonElement,
  ) => {
    active.current?.abort();
    revokeUrl();
    returnFocus.current = trigger;
    const controller = new AbortController();
    active.current = controller;
    setState({
      error: null,
      href,
      isLoading: true,
      isOpen: true,
      name,
      url: null,
    });
    try {
      const text = await mailApi.previewAttachment(href, controller.signal);
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(
        new Blob([text], { type: "text/plain;charset=utf-8" }),
      );
      activeUrl.current = url;
      setState({
        error: null,
        href,
        isLoading: false,
        isOpen: true,
        name,
        url,
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      setState({
        error:
          error instanceof Error
            ? error.message
            : "Unable to preview this attachment.",
        href,
        isLoading: false,
        isOpen: true,
        name,
        url: null,
      });
    } finally {
      if (active.current === controller) active.current = null;
    }
  }, [revokeUrl]);

  return { ...state, close, open, restoreFocus };
};
