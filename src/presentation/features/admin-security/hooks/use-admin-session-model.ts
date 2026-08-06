"use client";

import { useCallback, useEffect, useState } from "react";

import type { AdminSessionModel } from "@/presentation/features/admin-security/admin-session.view-model";
import {
  adminSessionsApi,
  type AdminSessionsSnapshot,
} from "@/transport/client/api-client";

export const useAdminSessionModel = (): AdminSessionModel => {
  const [snapshot, setSnapshot] = useState<AdminSessionsSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRevoking, setIsRevoking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setIsLoading(true);
    setError(null);
    void adminSessionsApi.get()
      .then(setSnapshot)
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Unable to load sessions.");
      })
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(load, [load]);

  const onRevoke = useCallback((id: string, kind: "administrator" | "member") => {
    setIsRevoking(id);
    setError(null);
    void adminSessionsApi.revoke(id, kind)
      .then(({ revokedCurrent }) => {
        if (revokedCurrent) {
          window.location.assign("/admin");
          return;
        }
        load();
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Unable to revoke session.");
      })
      .finally(() => setIsRevoking(null));
  }, [load]);

  return { error, isLoading, isRevoking, onRevoke, snapshot };
};
