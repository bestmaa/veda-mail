"use client";

import { type FormEvent, useCallback, useState } from "react";

import type { MemberTwoFactorEnrollment } from "@/domain/member/member-settings";
import type { AccountSettingsViewModel } from "@/presentation/features/mail-workspace/account-settings.view-model";
import { memberTwoFactorApi } from "@/transport/client/api-client";

export const useTwoFactorSettingsModel = () => {
  const [enabled, setEnabled] = useState(false);
  const [enrollment, setEnrollment] =
    useState<MemberTwoFactorEnrollment | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const reset = useCallback((nextEnabled: boolean) => {
    setEnabled(nextEnabled);
    setEnrollment(null);
    setCurrentPassword("");
    setOtpCode("");
    setError(null);
    setSuccess(null);
  }, []);

  const startEnrollment = useCallback(() => {
    setIsSaving(true);
    setError(null);
    setSuccess(null);
    void memberTwoFactorApi
      .start()
      .then(({ enrollment: nextEnrollment }) => {
        setEnrollment(nextEnrollment);
        setOtpCode("");
        setCurrentPassword("");
      })
      .catch((caught: unknown) => {
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to start authenticator setup.",
        );
      })
      .finally(() => setIsSaving(false));
  }, []);

  const onEnable = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setIsSaving(true);
      setError(null);
      setSuccess(null);
      void memberTwoFactorApi
        .confirm(currentPassword, otpCode)
        .then(({ sessionActive }) => {
          if (!sessionActive) {
            window.location.assign("/");
            return;
          }
          setEnabled(true);
          setEnrollment(null);
          setCurrentPassword("");
          setOtpCode("");
          setSuccess(
            "Authenticator verification is now enabled for your account.",
          );
        })
        .catch((caught: unknown) => {
          setError(
            caught instanceof Error
              ? caught.message
              : "Unable to enable authenticator verification.",
          );
        })
        .finally(() => setIsSaving(false));
    },
    [currentPassword, otpCode],
  );

  const onDisable = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setIsSaving(true);
      setError(null);
      setSuccess(null);
      void memberTwoFactorApi
        .disable(currentPassword, otpCode)
        .then(({ sessionActive }) => {
          if (!sessionActive) {
            window.location.assign("/");
            return;
          }
          setEnabled(false);
          setCurrentPassword("");
          setOtpCode("");
          setSuccess("Authenticator verification has been disabled.");
        })
        .catch((caught: unknown) => {
          setError(
            caught instanceof Error
              ? caught.message
              : "Unable to disable authenticator verification.",
          );
        })
        .finally(() => setIsSaving(false));
    },
    [currentPassword, otpCode],
  );

  const view = {
    cancelEnrollment: () => {
      setEnrollment(null);
      setOtpCode("");
      setCurrentPassword("");
      setError(null);
    },
    canManage: false,
    currentPassword,
    currentPasswordInput: (event) => setCurrentPassword(event.target.value),
    enabled,
    enrollment,
    error,
    isSaving,
    onDisable,
    onEnable,
    otpCode,
    otpCodeInput: (event) =>
      setOtpCode(event.target.value.replace(/\D/g, "").slice(0, 6)),
    startEnrollment,
    success,
  } satisfies AccountSettingsViewModel["twoFactor"];

  return { reset, view };
};
