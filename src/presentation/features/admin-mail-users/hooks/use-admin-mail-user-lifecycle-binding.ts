"use client";

import { useCallback, type Dispatch, type SetStateAction } from "react";

import type { BoundAdminMailUsersSnapshot } from "@/presentation/features/admin-mail-users/admin-mail-users-snapshot";
import { useAdminMailUserLifecycleModel } from "@/presentation/features/admin-mail-users/hooks/use-admin-mail-user-lifecycle-model";
import type { AdminMailUserDetail } from "@/transport/client/admin-mail-users-api";

export const useAdminMailUserLifecycleBinding = (input: {
  readonly handleFailure: (error: unknown, fallback: string) => void;
  readonly reportSuccess: (message: string) => void;
  readonly requiresOtp: boolean;
  readonly resetForwarding: () => void;
  readonly setBoundSnapshot: Dispatch<SetStateAction<BoundAdminMailUsersSnapshot | null>>;
  readonly setDetail: Dispatch<SetStateAction<AdminMailUserDetail | null>>;
}) => {
  const onCompleted = useCallback((operation: "disable" | "delete", email: string) => {
    input.setDetail(null);
    input.resetForwarding();
    if (operation === "delete") {
      input.setBoundSnapshot((current) => current ? {
        ...current,
        value: {
          ...current.value,
          users: current.value.users.filter((user) => user.email !== email),
        },
      } : current);
    }
    input.reportSuccess(operation === "delete"
      ? `${email} was permanently deleted.`
      : `${email} access was disabled; mailbox data was preserved.`);
  }, [input]);
  return useAdminMailUserLifecycleModel({
    handleFailure: input.handleFailure,
    onCompleted,
    requiresOtp: input.requiresOtp,
  });
};
