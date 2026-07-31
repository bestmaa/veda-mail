"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";

import { mailApi } from "@/transport/client/api-client";
import {
  ignoreMailSessionFailure,
  type MailSessionFailureHandler,
} from "@/presentation/features/mail-workspace/hooks/mail-session-failure";

export const useAttachmentCapability = (
  initialMaximum: number | null,
  sessionScope: string,
  initialSessionScope = "",
  handleSessionFailure: MailSessionFailureHandler = ignoreMailSessionFailure,
) => {
  const [maximum, setMaximum] = useState<number | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const requestSequence = useRef(0);

  useLayoutEffect(() => {
    requestSequence.current += 1;
    setMaximum(
      sessionScope && sessionScope === initialSessionScope
        ? initialMaximum
        : null,
    );
    setIsRefreshing(false);
    return () => {
      requestSequence.current += 1;
    };
  }, [initialMaximum, initialSessionScope, sessionScope]);

  const refresh = useCallback(async () => {
    if (!sessionScope) {
      setMaximum(null);
      return;
    }
    const sequence = ++requestSequence.current;
    setIsRefreshing(true);
    try {
      const capability = await mailApi.getAttachmentCapability(sessionScope);
      if (requestSequence.current === sequence) {
        setMaximum(capability.maxAttachmentBytes);
      }
    } catch (error) {
      if (requestSequence.current !== sequence) return;
      if (handleSessionFailure(error)) return;
      setMaximum(null);
    } finally {
      if (requestSequence.current === sequence) setIsRefreshing(false);
    }
  }, [handleSessionFailure, sessionScope]);

  return {
    isRefreshing,
    maximum,
    refresh,
    unavailable: maximum === null,
  };
};
