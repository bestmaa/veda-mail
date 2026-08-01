"use client";

import { useEffect } from "react";

export const shouldBlockComposerUnload = ({
  hasDurableIntent,
  hasLocalAttachments,
  isOpen,
  localCheckpointCurrent,
}: {
  readonly hasDurableIntent: boolean;
  readonly hasLocalAttachments: boolean;
  readonly isOpen: boolean;
  readonly localCheckpointCurrent: boolean;
}): boolean => isOpen && hasDurableIntent &&
  (hasLocalAttachments || !localCheckpointCurrent);

export const useComposerPageLifecycle = (
  shouldBlockUnload: boolean,
) => {
  useEffect(() => {
    if (!shouldBlockUnload) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [shouldBlockUnload]);
};
