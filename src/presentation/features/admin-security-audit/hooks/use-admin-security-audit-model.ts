"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import type {
  AdminSecurityAuditItem,
  AdminSecurityAuditViewProps,
} from "@/presentation/features/admin-security-audit/admin-security-audit.view-model";
import {
  adminSecurityAuditApi,
  type AdminSecurityAuditEntry,
} from "@/transport/client/admin-security-audit-api";
import { ApiClientError } from "@/transport/client/api-request";

const label = (value: string): string => value
  .split(".")
  .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).replaceAll("-", " ")}`)
  .join(" · ");

const item = (entry: AdminSecurityAuditEntry): AdminSecurityAuditItem => ({
  action: label(entry.action),
  actor: `${label(entry.actorType)} · ${entry.actorId.slice(0, 12)}`,
  count: entry.count === null ? null : String(entry.count),
  id: entry.id,
  outcome: label(entry.outcome),
  requestId: entry.requestId,
  target: entry.targetType && entry.targetId
    ? `${label(entry.targetType)} · ${entry.targetId.slice(0, 12)}`
    : null,
  timestamp: new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium", timeStyle: "medium",
  }).format(new Date(entry.at)),
});

export const useAdminSecurityAuditModel = (): AdminSecurityAuditViewProps => {
  const router = useRouter();
  const [entries, setEntries] = useState<readonly AdminSecurityAuditEntry[]>([]);
  const [droppedCount, setDroppedCount] = useState(0);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [verifiedAt, setVerifiedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fail = useCallback((caught: unknown) => {
    if (caught instanceof ApiClientError && caught.status === 401) {
      router.replace("/admin/login");
      router.refresh();
    } else {
      setError(caught instanceof Error ? caught.message : "Unable to load audit events.");
    }
  }, [router]);
  const load = useCallback(async () => {
    setIsLoading(true); setError(null);
    try {
      const page = await adminSecurityAuditApi.list({ limit: 100 });
      setEntries(page.entries); setDroppedCount(page.droppedCount);
      setNextCursor(page.nextCursor); setVerifiedAt(page.verifiedAt);
    } catch (caught) { fail(caught); }
    finally { setIsLoading(false); }
  }, [fail]);
  useEffect(() => { void load(); }, [load]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true); setError(null);
    try {
      const page = await adminSecurityAuditApi.list({
        beforeSequence: nextCursor, limit: 100,
      });
      setEntries((current) => [...current, ...page.entries]);
      setDroppedCount(page.droppedCount); setNextCursor(page.nextCursor);
      setVerifiedAt(page.verifiedAt);
    } catch (caught) { fail(caught); }
    finally { setIsLoadingMore(false); }
  }, [fail, isLoadingMore, nextCursor]);

  return {
    droppedCount, error, isLoading, isLoadingMore,
    items: entries.map(item), nextCursor,
    onLoadMore: () => void loadMore(), onRetry: () => void load(), verifiedAt,
  };
};
