"use client";

import { useCallback, useEffect, useState } from "react";

export const useBulkDestroyConfirmation = (
  enabled: boolean,
  destroy: () => void,
) => {
  const [isOpen, setIsOpen] = useState(false);
  useEffect(() => {
    if (!enabled) setIsOpen(false);
  }, [enabled]);
  return {
    isOpen,
    onCancel: useCallback(() => setIsOpen(false), []),
    onConfirm: useCallback(() => {
      setIsOpen(false);
      destroy();
    }, [destroy]),
    onRequest: useCallback(() => {
      if (enabled) setIsOpen(true);
    }, [enabled]),
  };
};
