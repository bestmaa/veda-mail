"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { memberSessionApi } from "@/transport/client/api-client";
import {
  ignoreMailSessionFailure,
  type MailSessionFailureHandler,
} from "@/presentation/features/mail-workspace/hooks/mail-session-failure";

export const useMemberSessionModel = (
  canSignOut: boolean,
  signOutPath: string,
  sessionScope: string,
  handleSessionFailure: MailSessionFailureHandler = ignoreMailSessionFailure,
) => {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const scopeRef = useRef(sessionScope);
  const effectiveCanSignOut = canSignOut && Boolean(sessionScope);

  useLayoutEffect(() => {
    scopeRef.current = sessionScope;
    setError(null);
    setIsSigningOut(false);
  }, [sessionScope]);

  const onSignOut = useCallback(async () => {
    if (!effectiveCanSignOut || isSigningOut) {
      return;
    }
    setError(null);
    setIsSigningOut(true);
    const requestScope = sessionScope;
    try {
      await memberSessionApi.signOut(requestScope);
      if (scopeRef.current !== requestScope) return;
      router.replace(signOutPath);
      router.refresh();
    } catch (caught) {
      if (scopeRef.current !== requestScope) return;
      if (handleSessionFailure(caught)) return;
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to sign out of this mailbox.",
      );
      setIsSigningOut(false);
    }
  }, [
    effectiveCanSignOut,
    handleSessionFailure,
    isSigningOut,
    router,
    sessionScope,
    signOutPath,
  ]);

  return {
    canSignOut: effectiveCanSignOut,
    error,
    isSigningOut,
    onSignOut,
  };
};
