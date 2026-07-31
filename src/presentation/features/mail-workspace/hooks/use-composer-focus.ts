"use client";

import { useCallback, useEffect, useRef } from "react";

export const useComposerReturnFocus = () => {
  const returnFocus = useRef<HTMLElement | null>(null);
  return {
    remember: useCallback(() => {
      returnFocus.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    }, []),
    restore: useCallback(() => {
      window.requestAnimationFrame(() => returnFocus.current?.focus());
    }, []),
  };
};

export const useComposerFocusTrap = (
  isOpen: boolean,
  isSending: boolean,
  onEscape: () => void,
) => {
  useEffect(() => {
    if (!isOpen || !isSending) return;
    const frame = window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(
          '[role="dialog"][aria-label="Compose message"]',
        )
        ?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen, isSending]);

  useEffect(() => {
    if (!isOpen) return;
    const handleDialogKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onEscape();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = document.querySelector<HTMLElement>(
        '[role="dialog"][aria-label="Compose message"]',
      );
      if (isSending && dialog) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const focusable = [
        ...(dialog?.querySelectorAll<HTMLElement>(
          "a[href], button:not(:disabled), input:not(:disabled), " +
            "select:not(:disabled), textarea:not(:disabled), " +
            "[contenteditable='true'], [tabindex]:not([tabindex='-1'])",
        ) ?? []),
      ].filter(
        (element) =>
          !element.closest("[hidden]") &&
          !element.closest("[inert]") &&
          !element.matches(":disabled, [aria-disabled='true']") &&
          element.getAttribute("contenteditable") !== "false" &&
          element.getClientRects().length > 0,
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!dialog) return;
      if (!first || !last) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const active =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      if (!active || !dialog.contains(active) || !focusable.includes(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleDialogKeys);
    return () => window.removeEventListener("keydown", handleDialogKeys);
  }, [isOpen, isSending, onEscape]);
};
