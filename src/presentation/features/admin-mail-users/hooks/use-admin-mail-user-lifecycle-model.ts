"use client";

import { useCallback, useRef, useState, type FormEventHandler } from "react";

import type { MailUserLifecycleCapability } from "@/domain/admin/mail-user";
import type { AdminMailUserLifecycleViewModel } from "@/presentation/features/admin-mail-users/admin-mail-users.view-model";
import { adminMailUsersApi } from "@/transport/client/admin-mail-users-api";

interface Target {
  readonly capability?: MailUserLifecycleCapability;
  readonly domain: string;
  readonly email: string;
  readonly id: string;
}

export const useAdminMailUserLifecycleModel = (input: {
  readonly handleFailure: (error: unknown, fallback: string) => void;
  readonly onCompleted: (operation: "disable" | "delete", email: string) => void;
  readonly requiresOtp: boolean;
}) => {
  const [target, setTarget] = useState<Target | null>(null);
  const [operation, setOperation] = useState<"disable" | "delete" | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const idempotencyKey = useRef<string | null>(null);

  const clearForm = useCallback(() => {
    setOperation(null);
    setConfirmation("");
    setAdminPassword("");
    setOtpCode("");
    idempotencyKey.current = null;
  }, []);
  const reset = useCallback(() => {
    clearForm();
    setTarget(null);
  }, [clearForm]);
  const load = useCallback((next: Target) => {
    clearForm();
    setTarget(next);
  }, [clearForm]);
  const begin = useCallback((next: "disable" | "delete") => {
    clearForm();
    idempotencyKey.current = crypto.randomUUID();
    setOperation(next);
  }, [clearForm]);
  const onSubmit: FormEventHandler<HTMLFormElement> = useCallback(async (event) => {
    event.preventDefault();
    if (!target || !operation || isSaving) return;
    const key = idempotencyKey.current ?? crypto.randomUUID();
    idempotencyKey.current = key;
    setIsSaving(true);
    try {
      await adminMailUsersApi.mutateLifecycle(
        target.id,
        target.domain,
        operation,
        {
          confirmationEmail: confirmation,
          currentAdminPassword: adminPassword,
          ...(otpCode ? { otpCode } : {}),
        },
        key,
      );
      input.onCompleted(operation, target.email);
      clearForm();
    } catch (error) {
      input.handleFailure(
        error,
        operation === "delete"
          ? "Unable to delete this mailbox."
          : "Unable to disable this mailbox.",
      );
    } finally {
      setIsSaving(false);
    }
  }, [adminPassword, clearForm, confirmation, input, isSaving, operation, otpCode, target]);

  const model: AdminMailUserLifecycleViewModel = {
    adminPassword,
    adminPasswordInput: (event) => setAdminPassword(event.target.value),
    available: target?.capability?.available !== false,
    confirmation,
    confirmationInput: (event) => setConfirmation(event.target.value.slice(0, 320)),
    email: target?.email ?? null,
    isSaving,
    onCancel: clearForm,
    onDelete: () => begin("delete"),
    onDisable: () => begin("disable"),
    onSubmit,
    operation,
    otpCode,
    otpCodeInput: (event) => setOtpCode(event.target.value.slice(0, 64)),
    protected: target?.capability?.protected === true,
    requiresOtp: input.requiresOtp,
  };
  return { load, model, reset };
};
