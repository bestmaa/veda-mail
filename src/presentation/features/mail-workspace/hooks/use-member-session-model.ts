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
import {
  MEMBER_SESSION_RECOVERY_PURGE_ERROR,
  purgeMemberSessionRecovery,
  type MemberSessionRecoveryPurger,
} from "@/presentation/features/mail-workspace/member-session-recovery";
import {
  browserMemberSessionRevocationBus,
  type MemberSessionRevocationBus,
  type MemberSessionRevocationReason,
} from "@/presentation/features/mail-workspace/member-session-revocation";
import { useMemberSessionRevocation } from "@/presentation/features/mail-workspace/hooks/use-member-session-revocation";

type MemberSessionPrivacyState =
  | { readonly error: null; readonly phase: "inactive"; readonly scope: "" }
  | { readonly error: null; readonly phase: "purging"; readonly scope: string }
  | { readonly error: string; readonly phase: "failed"; readonly scope: string };

const inactivePrivacyState: MemberSessionPrivacyState = {
  error: null,
  phase: "inactive",
  scope: "",
};

interface MemberSessionModelOptions {
  readonly canSignOut: boolean;
  readonly handleSessionFailure?: MailSessionFailureHandler;
  readonly purgeRecovery?: MemberSessionRecoveryPurger;
  readonly revocationBus?: MemberSessionRevocationBus;
  readonly requiresConfirmation?: boolean;
  readonly sessionExpiresAt?: string;
  readonly sessionScope: string;
  readonly signOutPath: string;
}

export const useMemberSessionModel = ({
  canSignOut,
  handleSessionFailure = ignoreMailSessionFailure,
  purgeRecovery = purgeMemberSessionRecovery,
  revocationBus = browserMemberSessionRevocationBus(),
  requiresConfirmation = false,
  sessionExpiresAt = "",
  sessionScope,
  signOutPath,
}: MemberSessionModelOptions) => {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isConfirmationOpen, setIsConfirmationOpen] = useState(false);
  const [isServerSignOutPending, setIsServerSignOutPending] = useState(false);
  const [privacy, setPrivacy] = useState<MemberSessionPrivacyState>(
    inactivePrivacyState,
  );
  const scopeRef = useRef(sessionScope);
  const previousScopeRef = useRef(sessionScope);
  const serverRequestsRef = useRef(new Set<string>());
  const cleanupRequestsRef = useRef(new Map<string, Promise<void>>());
  const privacyIsOpen =
    privacy.phase !== "inactive" && privacy.scope === sessionScope;
  const isSigningOut =
    isServerSignOutPending ||
    (privacyIsOpen && privacy.phase === "purging");
  const effectiveCanSignOut = canSignOut && Boolean(sessionScope);

  useLayoutEffect(() => {
    scopeRef.current = sessionScope;
    setError(null);
    setIsConfirmationOpen(false);
    setIsServerSignOutPending(false);
    setPrivacy(inactivePrivacyState);
  }, [sessionScope]);

  const completeLocalCleanup = useCallback(async (
    requestScope: string,
    allowClearedScope = false,
  ) => {
    if (!requestScope) return;
    if (scopeRef.current === requestScope) {
      setPrivacy({ error: null, phase: "purging", scope: requestScope });
    }
    const existing = cleanupRequestsRef.current.get(requestScope);
    let request = existing ?? null;
    try {
      request ??= purgeRecovery(requestScope);
      if (!existing) cleanupRequestsRef.current.set(requestScope, request);
      await request;
    } catch {
      if (scopeRef.current === requestScope) {
        setPrivacy({
          error: MEMBER_SESSION_RECOVERY_PURGE_ERROR,
          phase: "failed",
          scope: requestScope,
        });
      }
      return;
    } finally {
      if (
        !existing && request &&
        cleanupRequestsRef.current.get(requestScope) === request
      ) {
        cleanupRequestsRef.current.delete(requestScope);
      }
    }
    if (
      scopeRef.current !== requestScope &&
      !(allowClearedScope && !scopeRef.current)
    ) return;
    router.replace(signOutPath);
    router.refresh();
  }, [purgeRecovery, router, signOutPath]);

  useLayoutEffect(() => {
    const previousScope = previousScopeRef.current;
    previousScopeRef.current = sessionScope;
    if (previousScope && !sessionScope) {
      void completeLocalCleanup(previousScope, true);
    }
  }, [completeLocalCleanup, sessionScope]);

  const revokeAndCleanup = useCallback(async (
    requestScope: string,
    reason: MemberSessionRevocationReason,
    publish: boolean,
  ) => {
    if (scopeRef.current === requestScope) {
      setError(null);
      setIsConfirmationOpen(false);
      setIsServerSignOutPending(false);
      setPrivacy({ error: null, phase: "purging", scope: requestScope });
    }
    if (publish) revocationBus.publish(requestScope, reason);
    await completeLocalCleanup(requestScope);
  }, [completeLocalCleanup, revocationBus]);

  useMemberSessionRevocation({
    bus: revocationBus,
    expiresAt: sessionExpiresAt,
    onRevoke: useCallback((event) => {
      if (scopeRef.current !== event.sessionScope) return;
      void revokeAndCleanup(event.sessionScope, event.reason, false);
    }, [revokeAndCleanup]),
    sessionScope,
  });

  const performSignOut = useCallback(async () => {
    if (
      !effectiveCanSignOut ||
      privacyIsOpen ||
      serverRequestsRef.current.has(sessionScope)
    ) {
      return;
    }
    setError(null);
    setIsServerSignOutPending(true);
    const requestScope = sessionScope;
    serverRequestsRef.current.add(requestScope);
    try {
      await memberSessionApi.signOut(requestScope);
    } catch (caught) {
      if (scopeRef.current !== requestScope) return;
      setIsServerSignOutPending(false);
      if (handleSessionFailure(caught)) {
        setIsConfirmationOpen(false);
        return;
      }
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to sign out of this mailbox.",
      );
      setIsConfirmationOpen(false);
      setIsServerSignOutPending(false);
      return;
    } finally {
      serverRequestsRef.current.delete(requestScope);
    }
    await revokeAndCleanup(requestScope, "signed-out", true);
  }, [
    effectiveCanSignOut,
    handleSessionFailure,
    privacyIsOpen,
    revokeAndCleanup,
    sessionScope,
  ]);

  const onSignOut = useCallback(async () => {
    if (!effectiveCanSignOut || isSigningOut) return;
    if (requiresConfirmation) {
      setIsConfirmationOpen(true);
      return;
    }
    await performSignOut();
  }, [effectiveCanSignOut, isSigningOut, performSignOut,
    requiresConfirmation]);
  const onConfirmSignOut = useCallback(async () => {
    await performSignOut();
  }, [performSignOut]);
  const onCancelSignOut = useCallback(() => {
    if (!isSigningOut) setIsConfirmationOpen(false);
  }, [isSigningOut]);
  const onRetryCleanup = useCallback(async () => {
    if (!privacyIsOpen || privacy.phase !== "failed") return;
    await completeLocalCleanup(privacy.scope);
  }, [completeLocalCleanup, privacy, privacyIsOpen]);

  return {
    canSignOut: effectiveCanSignOut && !privacyIsOpen,
    error,
    confirmation: {
      isOpen: isConfirmationOpen,
      onCancel: onCancelSignOut,
      onConfirm: onConfirmSignOut,
    },
    isSigningOut,
    onSignOut,
    privacyCurtain: {
      error: privacyIsOpen ? privacy.error : null,
      isOpen: privacyIsOpen,
      isPurging: privacyIsOpen && privacy.phase === "purging",
      onRetryCleanup,
    },
  };
};
