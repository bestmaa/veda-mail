"use client";

import { useEffect, useRef } from "react";

const messageTrigger = (messageId: string): HTMLElement | null =>
  [...document.querySelectorAll<HTMLElement>("[data-message-id]")]
    .find((element) => element.dataset["messageId"] === messageId) ?? null;

const shouldEnterReader = (messageId: string): boolean => {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || active === document.body) return true;
  if (active.closest("#message-reader-region")) return false;
  return active.closest<HTMLElement>("[data-message-id]")
    ?.dataset["messageId"] === messageId;
};

const shouldReturnToList = (): boolean => {
  const active = document.activeElement;
  return !(active instanceof HTMLElement) || active === document.body ||
    Boolean(active.closest("#message-reader-region")) ||
    active.hasAttribute("data-keyboard-shortcuts-trigger");
};

export const ReaderFocusConnector = ({
  isLoading,
  messageId,
}: {
  readonly isLoading: boolean;
  readonly messageId: string | null;
}) => {
  const previousId = useRef<string | null>(null);
  useEffect(() => {
    const returnId = previousId.current;
    if (messageId) previousId.current = messageId;
    const frame = window.requestAnimationFrame(() => {
      if (messageId && !isLoading && shouldEnterReader(messageId)) {
        document.querySelector<HTMLElement>("[data-reader-heading]")?.focus();
      } else if (!messageId && returnId && shouldReturnToList()) {
        (messageTrigger(returnId) ??
          document.querySelector<HTMLElement>("[data-message-list-heading]"))
          ?.focus();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isLoading, messageId]);
  return null;
};
