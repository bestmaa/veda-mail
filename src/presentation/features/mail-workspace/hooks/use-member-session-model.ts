"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { memberSessionApi } from "@/transport/client/api-client";

export const useMemberSessionModel = (
  canSignOut: boolean,
  signOutPath: string,
) => {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const onSignOut = useCallback(async () => {
    if (!canSignOut || isSigningOut) {
      return;
    }
    setError(null);
    setIsSigningOut(true);
    try {
      await memberSessionApi.signOut();
      router.replace(signOutPath);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to sign out of this mailbox.",
      );
      setIsSigningOut(false);
    }
  }, [canSignOut, isSigningOut, router, signOutPath]);

  return {
    canSignOut,
    error,
    isSigningOut,
    onSignOut,
  };
};
