"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { mailApi } from "@/transport/client/api-client";

export const useAttachmentCapability = (initialMaximum: number | null) => {
  const [maximum, setMaximum] = useState(initialMaximum);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const requestSequence = useRef(0);

  useEffect(() => {
    setMaximum(initialMaximum);
  }, [initialMaximum]);

  useEffect(
    () => () => {
      requestSequence.current += 1;
    },
    [],
  );

  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setIsRefreshing(true);
    try {
      const capability = await mailApi.getAttachmentCapability();
      if (requestSequence.current === sequence) {
        setMaximum(capability.maxAttachmentBytes);
      }
    } catch {
      if (requestSequence.current === sequence) setMaximum(null);
    } finally {
      if (requestSequence.current === sequence) setIsRefreshing(false);
    }
  }, []);

  return {
    isRefreshing,
    maximum,
    refresh,
    unavailable: maximum === null,
  };
};
