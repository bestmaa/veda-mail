"use client";

import { useEffect, useRef } from "react";

const focusableElements = (dialog: HTMLElement): readonly HTMLElement[] =>
  [
    ...dialog.querySelectorAll<HTMLElement>(
      "a[href], button:not(:disabled), input:not(:disabled), " +
        "select:not(:disabled), textarea:not(:disabled), " +
        "[contenteditable='true'], [tabindex]:not([tabindex='-1'])",
    ),
  ].filter(
    (element) =>
      !element.closest("[hidden]") &&
      !element.matches(":disabled, [aria-disabled='true']") &&
      element.getAttribute("contenteditable") !== "false" &&
      element.getClientRects().length > 0,
  );

const activeModal = (): HTMLElement | null => {
  const dialogs = [
    ...document.querySelectorAll<HTMLElement>(
      '[role="alertdialog"][aria-modal="true"], [role="dialog"][aria-modal="true"]',
    ),
  ].filter((dialog) => dialog.getClientRects().length > 0);
  return dialogs.at(-1) ?? null;
};

export const useModalDialogFocus = (
  isOpen: boolean,
  selector: string,
  onEscape: () => void,
  initialFocusSelector?: string,
): void => {
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    returnFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const frame = window.requestAnimationFrame(() => {
      const dialog = document.querySelector<HTMLElement>(selector);
      if (!dialog) return;
      const initial = initialFocusSelector
        ? dialog.querySelector<HTMLElement>(initialFocusSelector)
        : null;
      (initial ?? focusableElements(dialog)[0] ?? dialog).focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.requestAnimationFrame(() => returnFocus.current?.focus());
    };
  }, [initialFocusSelector, isOpen, selector]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const dialog = document.querySelector<HTMLElement>(selector);
      if (!dialog || activeModal() !== dialog) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onEscape();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = focusableElements(dialog);
      const first = focusable[0];
      const last = focusable.at(-1);
      const active =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      if (!first || !last) {
        event.preventDefault();
        dialog.focus();
      } else if (!active || !dialog.contains(active)) {
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
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onEscape, selector]);
};
