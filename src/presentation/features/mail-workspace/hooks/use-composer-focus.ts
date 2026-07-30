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

export const useComposerFocusTrap = (isOpen: boolean, onEscape: () => void) => {
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
      const focusable = [
        ...(dialog?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex='0']",
        ) ?? []),
      ];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleDialogKeys);
    return () => window.removeEventListener("keydown", handleDialogKeys);
  }, [isOpen, onEscape]);
};
