"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useState,
  type ChangeEventHandler,
  type FormEventHandler,
} from "react";

import type { MemberLoginViewProps } from "@/presentation/features/member-login/member-login.view-model";
import {
  createBrandingViewModel,
  type BrandingInput,
} from "@/presentation/shared/branding/branding.view-model";
import { memberSessionApi } from "@/transport/client/api-client";

export const useMemberLoginModel = (
  adminHref: string,
  brandingInput: BrandingInput,
  providerLabel: string,
  successPath: string,
): MemberLoginViewProps => {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [isTwoFactorStep, setIsTwoFactorStep] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const onEmailInput: ChangeEventHandler<HTMLInputElement> = useCallback(
    (event) => setEmail(event.target.value),
    [],
  );
  const onPasswordInput: ChangeEventHandler<HTMLInputElement> = useCallback(
    (event) => setPassword(event.target.value),
    [],
  );
  const onOtpCodeInput: ChangeEventHandler<HTMLInputElement> = useCallback(
    (event) => setOtpCode(event.target.value.toUpperCase().slice(0, 64)),
    [],
  );

  const onSubmit: FormEventHandler<HTMLFormElement> = useCallback(
    async (event) => {
      event.preventDefault();
      setError(null);
      setIsSubmitting(true);
      try {
        const result = await memberSessionApi.signIn({
          email: email.trim(),
          password,
          ...(otpCode ? { otpCode } : {}),
        });
        if (result.mfaRequired) {
          setIsTwoFactorStep(true);
          setOtpCode("");
          setIsSubmitting(false);
          return;
        }
        router.replace(successPath);
        router.refresh();
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to sign in to this mailbox.",
        );
        setIsSubmitting(false);
      }
    },
    [email, otpCode, password, router, successPath],
  );

  return {
    adminHref,
    branding: createBrandingViewModel(brandingInput),
    email,
    error,
    isSubmitting,
    isTwoFactorStep,
    onBackToPassword: () => {
      setError(null);
      setOtpCode("");
      setIsTwoFactorStep(false);
    },
    onEmailInput,
    onOtpCodeInput,
    onPasswordInput,
    onSubmit,
    otpCode,
    password,
    providerLabel,
    submitLabel: isSubmitting
      ? "Verifying…"
      : isTwoFactorStep
        ? "Verify and open mailbox"
        : "Open mailbox",
  };
};
