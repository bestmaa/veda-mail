"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEventHandler,
  type FormEventHandler,
} from "react";

import {
  mailUserDetail,
  mailUserListItem,
} from "@/presentation/features/admin-mail-users/admin-mail-users.formatters";
import { isAdminSessionUnauthorized } from "@/presentation/features/admin-mail-users/admin-mail-users-errors";
import {
  adminMailUsersCapabilityCopy,
  adminMailUsersSnapshotForDomain,
  bindAdminMailUsersSnapshot,
  type BoundAdminMailUsersSnapshot,
} from "@/presentation/features/admin-mail-users/admin-mail-users-snapshot";
import type { AdminMailUsersViewProps } from "@/presentation/features/admin-mail-users/admin-mail-users.view-model";
import { useAdminMailUserCreateModel } from "@/presentation/features/admin-mail-users/hooks/use-admin-mail-user-create-model";
import {
  adminMailUsersApi,
  type AdminMailUserDetail,
} from "@/transport/client/admin-mail-users-api";

export const useAdminMailUsersModel = (): AdminMailUsersViewProps => {
  const router = useRouter();
  const [boundSnapshot, setBoundSnapshot] =
    useState<BoundAdminMailUsersSnapshot | null>(null);
  const [selectedDomain, setSelectedDomain] = useState("");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [detail, setDetail] = useState<AdminMailUserDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const detailRequest = useRef<AbortController | null>(null);
  const selectedDomainValue = useRef("");

  const unauthorized = useCallback(() => {
    router.replace("/admin/login");
    router.refresh();
  }, [router]);
  const reportError = useCallback((message: string) => {
    setSuccess(null);
    setError(message);
  }, []);
  const reportSuccess = useCallback((message: string) => {
    setError(null);
    setSuccess(message);
  }, []);
  const handleFailure = useCallback(
    (caught: unknown, fallback: string) => {
      if (isAdminSessionUnauthorized(caught)) {
        unauthorized();
        return;
      }
      reportError(caught instanceof Error ? caught.message : fallback);
    },
    [reportError, unauthorized],
  );

  const load = useCallback(
    async (domain?: string, searchTerm = "") => {
      const sequence = ++requestSequence.current;
      setIsLoading(true);
      setIsLoadingMore(false);
      setBoundSnapshot(null);
      setAppliedSearch(searchTerm);
      detailRequest.current?.abort();
      detailRequest.current = null;
      setIsDetailLoading(false);
      setDetail(null);
      setError(null);
      try {
        const next = await adminMailUsersApi.getSnapshot({
          ...(domain ? { domain } : {}),
          ...(searchTerm ? { search: searchTerm } : {}),
        });
        if (sequence !== requestSequence.current) return;
        const activeDomain = domain || next.allowedDomains[0] || "";
        setBoundSnapshot(bindAdminMailUsersSnapshot(activeDomain, next));
        selectedDomainValue.current = activeDomain;
        setSelectedDomain(activeDomain);
      } catch (caught) {
        if (sequence === requestSequence.current) {
          handleFailure(caught, "Unable to load mailboxes.");
        }
      } finally {
        if (sequence === requestSequence.current) setIsLoading(false);
      }
    },
    [handleFailure],
  );

  useEffect(() => {
    void load();
    return () => {
      requestSequence.current += 1;
      detailRequest.current?.abort();
      detailRequest.current = null;
    };
  }, [load]);

  const onDomainInput: ChangeEventHandler<HTMLSelectElement> = useCallback(
    (event) => {
      const domain = event.target.value;
      selectedDomainValue.current = domain;
      setSelectedDomain(domain);
      setSearch("");
      void load(domain);
    },
    [load],
  );
  const onSearch: FormEventHandler<HTMLFormElement> = useCallback(
    (event) => {
      event.preventDefault();
      void load(selectedDomain, search.trim().slice(0, 120));
    },
    [load, search, selectedDomain],
  );
  const snapshot = adminMailUsersSnapshotForDomain(
    boundSnapshot,
    selectedDomain,
  );
  const onLoadMore = useCallback(async () => {
    if (!snapshot?.nextCursor || isLoadingMore) return;
    const sequence = requestSequence.current;
    setIsLoadingMore(true);
    try {
      const next = await adminMailUsersApi.getSnapshot({
        cursor: snapshot.nextCursor,
        domain: selectedDomain,
        ...(appliedSearch ? { search: appliedSearch } : {}),
      });
      if (sequence !== requestSequence.current) return;
      setBoundSnapshot((current) =>
        current?.domain === selectedDomain
          ? bindAdminMailUsersSnapshot(selectedDomain, {
              ...next,
              users: [...current.value.users, ...next.users],
            })
          : current,
      );
    } catch (caught) {
      if (sequence === requestSequence.current) {
        handleFailure(caught, "Unable to load more mailboxes.");
      }
    } finally {
      if (sequence === requestSequence.current) setIsLoadingMore(false);
    }
  }, [appliedSearch, handleFailure, isLoadingMore, selectedDomain, snapshot]);
  const openDetail = useCallback(
    async (id: string) => {
      detailRequest.current?.abort();
      const request = new AbortController();
      detailRequest.current = request;
      setIsDetailLoading(true);
      setError(null);
      try {
        const result = await adminMailUsersApi.getDetail(
          id,
          selectedDomain,
          request.signal,
        );
        if (detailRequest.current !== request) return;
        setDetail(result.user);
      } catch (caught) {
        if (!request.signal.aborted) {
          handleFailure(caught, "Unable to load mailbox details.");
        }
      } finally {
        if (detailRequest.current === request) setIsDetailLoading(false);
      }
    },
    [handleFailure, selectedDomain],
  );
  const onCreated = useCallback((user: AdminMailUserDetail, domain: string) => {
    if (selectedDomainValue.current !== domain) return;
    setDetail(user);
    setBoundSnapshot((current) =>
      current?.domain === domain
        ? bindAdminMailUsersSnapshot(domain, {
            ...current.value,
            users: [
              user,
              ...current.value.users.filter((item) => item.id !== user.id),
            ],
          })
        : current,
    );
  }, []);
  const create = useAdminMailUserCreateModel({
    available: snapshot?.status === "available" && snapshot.creation.available,
    onCreated,
    onError: reportError,
    onSuccess: reportSuccess,
    onUnauthorized: unauthorized,
    reason: snapshot?.creation.reason ?? null,
    requiresOtp: snapshot?.adminTwoFactorEnabled ?? false,
    selectedDomain,
  });
  const items = useMemo(
    () =>
      (snapshot?.users ?? []).map((user) =>
        ({
          ...mailUserListItem(user),
          onOpen: () => void openDetail(user.id),
        }),
      ),
    [openDetail, snapshot?.users],
  );
  const [capabilityTitle, capabilityDescription] = adminMailUsersCapabilityCopy(
    snapshot?.status ?? null,
  );

  return {
    capabilityDescription,
    capabilityTitle,
    create,
    detail: detail ? mailUserDetail(detail) : null,
    domainInput: onDomainInput,
    domains: snapshot?.allowedDomains ?? [],
    error,
    isDetailLoading,
    isLoading,
    isLoadingMore,
    items,
    nextCursor: snapshot?.nextCursor ?? null,
    onLoadMore: () => void onLoadMore(),
    onRetry: () => void load(selectedDomain, appliedSearch),
    onSearch,
    search,
    searchInput: (event) => setSearch(event.target.value.slice(0, 120)),
    selectedDomain,
    status: snapshot?.status ?? null,
    success,
  };
};
