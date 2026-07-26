"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useState,
  type ChangeEventHandler,
  type FormEventHandler,
} from "react";

import type { AdminLoginViewProps } from "@/presentation/features/admin-login/admin-login.view-model";
import {
  createBrandingViewModel,
  type BrandingInput,
} from "@/presentation/shared/branding/branding.view-model";

export const useAdminLoginModel = (
  successPath: string,
  brandingInput: BrandingInput,
): AdminLoginViewProps => {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [isTwoFactorStep, setIsTwoFactorStep] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const onPasswordInput: ChangeEventHandler<HTMLInputElement> = useCallback(
    (event) => setPassword(event.target.value),
    [],
  );
  const onUsernameInput: ChangeEventHandler<HTMLInputElement> = useCallback(
    (event) => setUsername(event.target.value),
    [],
  );
  const onOtpCodeInput: ChangeEventHandler<HTMLInputElement> = useCallback(
    (event) => setOtpCode(event.target.value),
    [],
  );
  const onBack = useCallback(() => {
    setIsTwoFactorStep(false);
    setOtpCode("");
    setError(null);
  }, []);

  const onSubmit: FormEventHandler<HTMLFormElement> = useCallback(
    async (event) => {
      event.preventDefault();
      setError(null);
      setIsSubmitting(true);
      try {
        const response = await fetch("/api/v1/admin/auth", {
          body: JSON.stringify({
            ...(isTwoFactorStep ? { otpCode } : {}),
            password,
            username: username.trim(),
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        if (!response.ok) {
          const failure = (await response.json().catch(() => ({}))) as {
            readonly error?: { readonly message?: string };
          };
          throw new Error(
            failure.error?.message ?? "Administrator credentials are invalid.",
          );
        }
        const success = (await response.json()) as {
          readonly data?: { readonly mfaRequired?: boolean };
        };
        if (success.data?.mfaRequired) {
          setIsTwoFactorStep(true);
          setIsSubmitting(false);
          return;
        }
        router.replace(successPath);
        router.refresh();
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to open administration.",
        );
        setIsSubmitting(false);
      }
    },
    [isTwoFactorStep, otpCode, password, router, successPath, username],
  );

  return {
    branding: createBrandingViewModel(brandingInput),
    error,
    isSubmitting,
    isTwoFactorStep,
    onBack,
    onOtpCodeInput,
    onPasswordInput,
    onSubmit,
    onUsernameInput,
    otpCode,
    password,
    submitLabel: isSubmitting
      ? "Checking access…"
      : isTwoFactorStep
        ? "Verify and continue"
        : "Open administration",
    username,
  };
};
