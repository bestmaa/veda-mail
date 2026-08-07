"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";

import type { MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import type { MemberSessionsViewModel } from "@/presentation/features/mail-workspace/member-sessions.view-model";
import {
  memberSessionsApi,
  type MemberSessionsSnapshot,
} from "@/transport/client/api-client";

export const useMemberSessionsModel = (
  sessionScope: string,
  handleSessionFailure: MailSessionFailureHandler,
) => {
  const [snapshot, setSnapshot] = useState<MemberSessionsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRevoking, setIsRevoking] = useState<string | null>(null);
  const scopeRef = useRef(sessionScope);
  useLayoutEffect(() => {
    scopeRef.current = sessionScope;
  }, [sessionScope]);

  const load = useCallback(() => {
    const scope = scopeRef.current;
    if (!scope) return;
    setIsLoading(true);
    setError(null);
    void memberSessionsApi.get(scope)
      .then((next) => {
        if (scopeRef.current === scope) setSnapshot(next);
      })
      .catch((caught: unknown) => {
        if (scopeRef.current !== scope || handleSessionFailure(caught)) return;
        setError(caught instanceof Error ? caught.message : "Unable to load sessions.");
      })
      .finally(() => {
        if (scopeRef.current === scope) setIsLoading(false);
      });
  }, [handleSessionFailure]);

  const reset = useCallback(() => {
    setSnapshot(null);
    setError(null);
    setIsLoading(false);
    setIsRevoking(null);
  }, []);

  const onRevoke = useCallback((id: string) => {
    const scope = scopeRef.current;
    if (!scope) return;
    setIsRevoking(id);
    setError(null);
    void memberSessionsApi.revoke(id, scope)
      .then(({ revokedCurrent }) => {
        if (revokedCurrent) {
          window.location.assign("/");
          return;
        }
        load();
      })
      .catch((caught: unknown) => {
        if (scopeRef.current !== scope || handleSessionFailure(caught)) return;
        setError(caught instanceof Error ? caught.message : "Unable to revoke session.");
      })
      .finally(() => {
        if (scopeRef.current === scope) setIsRevoking(null);
      });
  }, [handleSessionFailure, load]);

  return {
    load,
    reset,
    view: { error, isLoading, isRevoking, onRevoke, snapshot } satisfies MemberSessionsViewModel,
  } as const;
};
