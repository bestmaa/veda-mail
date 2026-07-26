"use client";

import {
  useCallback,
  useEffect,
  useState,
  type ChangeEventHandler,
  type FormEventHandler,
} from "react";

import type { AdminSecurityViewProps } from "@/presentation/features/admin-security/admin-security.view-model";
interface SecuritySnapshot {
  readonly recoveryCodesRemaining: number;
  readonly recoveryConfigured: boolean;
  readonly twoFactorEnabled: boolean;
}
interface AccountSnapshot {
  readonly security: SecuritySnapshot;
  readonly username: string;
}
const data = async <T,>(response: Response): Promise<T> => {
  const payload = (await response.json()) as {
    readonly data?: T;
    readonly error?: { readonly message?: string };
  };
  if (!response.ok || !payload.data) {
    throw new Error(payload.error?.message ?? "The request could not be completed.");
  }
  return payload.data;
};
export const useAdminSecurityModel = (): AdminSecurityViewProps => {
  const [username, setUsername] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [accountOtpCode, setAccountOtpCode] = useState("");
  const [security, setSecurity] = useState<SecuritySnapshot>({
    recoveryCodesRemaining: 0,
    recoveryConfigured: false,
    twoFactorEnabled: false,
  });
  const [twoFactorEnrollment, setTwoFactorEnrollment] =
    useState<AdminSecurityViewProps["twoFactorEnrollment"]>(null);
  const [twoFactorPassword, setTwoFactorPassword] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<readonly string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTwoFactorWorking, setIsTwoFactorWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void fetch("/api/v1/admin/account")
      .then((response) => data<AccountSnapshot>(response))
      .then((snapshot) => {
        if (!alive) return;
        setUsername(snapshot.username);
        setSecurity(snapshot.security);
        setIsLoading(false);
      })
      .catch((caught: unknown) => {
        if (!alive) return;
        setError(caught instanceof Error ? caught.message : "Unable to load administrator.");
        setIsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const input = useCallback(
    (setter: (value: string) => void): ChangeEventHandler<HTMLInputElement> =>
      (event) => setter(event.target.value),
    [],
  );
  const clearNotices = () => {
    setError(null);
    setSuccess(null);
  };

  const onSubmit: FormEventHandler<HTMLFormElement> = useCallback(
    async (event) => {
      event.preventDefault();
      clearNotices();
      if (newPassword && newPassword !== confirmation) {
        setError("New passwords do not match.");
        return;
      }
      if (
        newPassword &&
        (newPassword.length < 12 ||
          !/[a-z]/i.test(newPassword) ||
          !/\d/.test(newPassword))
      ) {
        setError("New password needs 12+ characters, a letter, and a number.");
        return;
      }
      setIsSaving(true);
      try {
        const snapshot = await data<AccountSnapshot>(
          await fetch("/api/v1/admin/account", {
            body: JSON.stringify({
              currentPassword,
              ...(newPassword ? { newPassword } : {}),
              ...(security.twoFactorEnabled ? { otpCode: accountOtpCode } : {}),
              username: username.trim(),
            }),
            headers: { "Content-Type": "application/json" },
            method: "PUT",
          }),
        );
        setUsername(snapshot.username);
        setSecurity(snapshot.security);
        setCurrentPassword("");
        setNewPassword("");
        setConfirmation("");
        setAccountOtpCode("");
        setSuccess(
          security.twoFactorEnabled
            ? "Administrator credentials updated. Two-factor authentication remains active."
            : "Administrator credentials updated.",
        );
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Unable to update administrator.");
      } finally {
        setIsSaving(false);
      }
    },
    [accountOtpCode, confirmation, currentPassword, newPassword, security.twoFactorEnabled, username],
  );

  const onStartTwoFactor = useCallback(async () => {
    clearNotices();
    setIsTwoFactorWorking(true);
    try {
      const result = await data<{
        readonly enrollment: NonNullable<AdminSecurityViewProps["twoFactorEnrollment"]>;
      }>(await fetch("/api/v1/admin/two-factor", { method: "POST" }));
      setTwoFactorEnrollment(result.enrollment);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to start 2FA.");
    } finally {
      setIsTwoFactorWorking(false);
    }
  }, []);

  const onTwoFactorSubmit: FormEventHandler<HTMLFormElement> = useCallback(
    async (event) => {
      event.preventDefault();
      clearNotices();
      setIsTwoFactorWorking(true);
      try {
        const result = await data<{
          readonly enabled: boolean;
          readonly recoveryCodes: readonly string[];
        }>(
          await fetch("/api/v1/admin/two-factor", {
            body: JSON.stringify({
              currentPassword: twoFactorPassword,
              otpCode: twoFactorCode,
            }),
            headers: { "Content-Type": "application/json" },
            method: "PUT",
          }),
        );
        setSecurity((current) => ({
          ...current,
          recoveryCodesRemaining: result.recoveryCodes.length,
          twoFactorEnabled: true,
        }));
        setRecoveryCodes(result.recoveryCodes);
        setTwoFactorEnrollment(null);
        setTwoFactorPassword("");
        setTwoFactorCode("");
        setSuccess("Administrator two-factor authentication is enabled.");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Unable to enable 2FA.");
      } finally {
        setIsTwoFactorWorking(false);
      }
    },
    [twoFactorCode, twoFactorPassword],
  );

  const onDisableTwoFactor = useCallback(async () => {
    clearNotices();
    setIsTwoFactorWorking(true);
    try {
      await data<{ readonly enabled: boolean }>(
        await fetch("/api/v1/admin/two-factor", {
          body: JSON.stringify({
            currentPassword: twoFactorPassword,
            otpCode: twoFactorCode,
          }),
          headers: { "Content-Type": "application/json" },
          method: "DELETE",
        }),
      );
      setSecurity((current) => ({
        ...current,
        recoveryCodesRemaining: 0,
        twoFactorEnabled: false,
      }));
      setTwoFactorPassword("");
      setTwoFactorCode("");
      setSuccess("Administrator two-factor authentication is disabled.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to disable 2FA.");
    } finally {
      setIsTwoFactorWorking(false);
    }
  }, [twoFactorCode, twoFactorPassword]);

  return {
    accountOtpCode,
    accountOtpCodeInput: input(setAccountOtpCode),
    confirmation,
    confirmationInput: input(setConfirmation),
    currentPassword,
    currentPasswordInput: input(setCurrentPassword),
    error,
    isLoading,
    isSaving,
    isTwoFactorWorking,
    newPassword,
    newPasswordInput: input(setNewPassword),
    onCopyRecoveryCodes: () =>
      void navigator.clipboard.writeText(recoveryCodes.join("\n")),
    onDisableTwoFactor,
    onDismissRecoveryCodes: () => setRecoveryCodes([]),
    onStartTwoFactor,
    onSubmit,
    onTwoFactorSubmit,
    recoveryCodes,
    recoveryCodesRemaining: security.recoveryCodesRemaining,
    recoveryConfigured: security.recoveryConfigured,
    success,
    twoFactorCode,
    twoFactorCodeInput: input(setTwoFactorCode),
    twoFactorEnabled: security.twoFactorEnabled,
    twoFactorEnrollment,
    twoFactorPassword,
    twoFactorPasswordInput: input(setTwoFactorPassword),
    username,
    usernameInput: input(setUsername),
  };
};
