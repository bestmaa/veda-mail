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

  const onSubmit: FormEventHandler<HTMLFormElement> = useCallback(
    async (event) => {
      event.preventDefault();
      setError(null);
      setIsSubmitting(true);
      try {
        await memberSessionApi.signIn({
          email: email.trim(),
          password,
        });
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
    [email, password, router, successPath],
  );

  return {
    adminHref,
    branding: createBrandingViewModel(brandingInput),
    email,
    error,
    isSubmitting,
    onEmailInput,
    onPasswordInput,
    onSubmit,
    password,
    providerLabel,
    submitLabel: isSubmitting ? "Opening mailbox…" : "Open mailbox",
  };
};
