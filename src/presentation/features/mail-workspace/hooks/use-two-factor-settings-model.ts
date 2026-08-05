"use client";

import {
  type FormEvent,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { MemberTwoFactorEnrollment } from "@/domain/member/member-settings";
import type { AccountSettingsViewModel } from "@/presentation/features/mail-workspace/account-settings.view-model";
import { memberTwoFactorApi } from "@/transport/client/api-client";
import {
  ignoreMailSessionFailure,
  type MailSessionFailureHandler,
} from "@/presentation/features/mail-workspace/hooks/mail-session-failure";

export const useTwoFactorSettingsModel = (
  sessionScope: string,
  handleSessionFailure: MailSessionFailureHandler = ignoreMailSessionFailure,
) => {
  const [enabled, setEnabled] = useState(false);
  const [enrollment, setEnrollment] =
    useState<MemberTwoFactorEnrollment | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const scopeRef = useRef(sessionScope);

  const reset = useCallback((nextEnabled: boolean) => {
    setEnabled(nextEnabled);
    setEnrollment(null);
    setCurrentPassword("");
    setOtpCode("");
    setRecoveryCodes([]);
    setError(null);
    setSuccess(null);
    setIsSaving(false);
  }, []);

  useLayoutEffect(() => {
    scopeRef.current = sessionScope;
    reset(false);
  }, [reset, sessionScope]);

  const startEnrollment = useCallback(() => {
    const requestScope = sessionScope;
    if (!requestScope) return;
    setIsSaving(true);
    setError(null);
    setSuccess(null);
    void memberTwoFactorApi
      .start(requestScope)
      .then(({ enrollment: nextEnrollment }) => {
        if (scopeRef.current !== requestScope) return;
        setEnrollment(nextEnrollment);
        setOtpCode("");
        setCurrentPassword("");
      })
      .catch((caught: unknown) => {
        if (scopeRef.current !== requestScope) return;
        if (handleSessionFailure(caught)) return;
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to start authenticator setup.",
        );
      })
      .finally(() => {
        if (scopeRef.current === requestScope) setIsSaving(false);
      });
  }, [handleSessionFailure, sessionScope]);

  const onEnable = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setIsSaving(true);
      setError(null);
      setSuccess(null);
      const requestScope = sessionScope;
      if (!requestScope) {
        setIsSaving(false);
        return;
      }
      void memberTwoFactorApi
        .confirm(currentPassword, otpCode, requestScope)
        .then(({ recoveryCodes: nextCodes, sessionActive }) => {
          if (scopeRef.current !== requestScope) return;
          if (!sessionActive) {
            window.location.assign("/");
            return;
          }
          setEnabled(true);
          setEnrollment(null);
          setCurrentPassword("");
          setOtpCode("");
          setRecoveryCodes(nextCodes);
          setSuccess(
            "Authenticator verification is now enabled for your account.",
          );
        })
        .catch((caught: unknown) => {
          if (scopeRef.current !== requestScope) return;
          if (handleSessionFailure(caught)) return;
          setError(
            caught instanceof Error
              ? caught.message
              : "Unable to enable authenticator verification.",
          );
        })
        .finally(() => {
          if (scopeRef.current === requestScope) setIsSaving(false);
        });
    },
    [currentPassword, handleSessionFailure, otpCode, sessionScope],
  );

  const onDisable = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setIsSaving(true);
      setError(null);
      setSuccess(null);
      const requestScope = sessionScope;
      if (!requestScope) {
        setIsSaving(false);
        return;
      }
      void memberTwoFactorApi
        .disable(currentPassword, otpCode, requestScope)
        .then(({ sessionActive }) => {
          if (scopeRef.current !== requestScope) return;
          if (!sessionActive) {
            window.location.assign("/");
            return;
          }
          setEnabled(false);
          setRecoveryCodes([]);
          setCurrentPassword("");
          setOtpCode("");
          setSuccess("Authenticator verification has been disabled.");
        })
        .catch((caught: unknown) => {
          if (scopeRef.current !== requestScope) return;
          if (handleSessionFailure(caught)) return;
          setError(
            caught instanceof Error
              ? caught.message
              : "Unable to disable authenticator verification.",
          );
        })
        .finally(() => {
          if (scopeRef.current === requestScope) setIsSaving(false);
        });
    },
    [currentPassword, handleSessionFailure, otpCode, sessionScope],
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
    disabledReason: null,
    copyRecoveryCodes: () =>
      void navigator.clipboard.writeText(recoveryCodes.join("\n")),
    enabled,
    enrollment,
    error,
    isSaving,
    onDisable,
    onEnable,
    otpCode,
    otpCodeInput: (event) =>
      setOtpCode(
        enrollment
          ? event.target.value.replace(/\D/g, "").slice(0, 6)
          : event.target.value.toUpperCase().slice(0, 64),
      ),
    recoveryCodes,
    startEnrollment,
    success,
  } satisfies AccountSettingsViewModel["twoFactor"];

  return { reset, view };
};
