"use client";

import { useCallback, useState } from "react";

export const useMobileNavigationModel = () => {
  const [isOpen, setIsOpen] = useState(false);

  return {
    close: useCallback(() => setIsOpen(false), []),
    isOpen,
    open: useCallback(() => setIsOpen(true), []),
  };
};
