"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEventHandler,
  type FormEventHandler,
} from "react";

import type { AdminMailUserCreateViewModel } from "@/presentation/features/admin-mail-users/admin-mail-users.view-model";
import {
  fingerprintMailboxIntent,
  idempotencyIntent,
  normalizeMailboxEmail,
  type MailUserIdempotencyIntent,
} from "@/presentation/features/admin-mail-users/admin-mail-user-create-intent";
import { isAdminSessionUnauthorized } from "@/presentation/features/admin-mail-users/admin-mail-users-errors";
import {
  adminMailUsersApi,
  type AdminMailUserDetail,
} from "@/transport/client/admin-mail-users-api";

interface CreateModelOptions {
  readonly available: boolean;
  readonly onCreated: (user: AdminMailUserDetail, domain: string) => void;
  readonly onError: (message: string) => void;
  readonly onSuccess: (message: string) => void;
  readonly onUnauthorized: () => void;
  readonly reason: string | null;
  readonly requiresOtp: boolean;
  readonly selectedDomain: string;
}

interface SecretValues {
  adminPassword: string;
  confirmation: string;
  mailboxPassword: string;
  otpCode: string;
}

const passwordIssue = (password: string, confirmation: string): string | null => {
  if (password !== confirmation) return "Mailbox passwords do not match.";
  if (
    password.length < 12 ||
    !/[a-z]/i.test(password) ||
    !/\d/.test(password)
  ) {
    return "Mailbox password needs 12+ characters, a letter, and a number.";
  }
  return null;
};

export const useAdminMailUserCreateModel = ({
  available,
  onCreated,
  onError,
  onSuccess,
  onUnauthorized,
  reason,
  requiresOtp,
  selectedDomain,
}: CreateModelOptions): AdminMailUserCreateViewModel => {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [mailboxPassword, setMailboxPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inFlight = useRef(false);
  const idempotency = useRef<MailUserIdempotencyIntent | null>(null);
  const secrets = useRef<SecretValues>({
    adminPassword: "",
    confirmation: "",
    mailboxPassword: "",
    otpCode: "",
  });

  const input = useCallback(
    (setter: (value: string) => void): ChangeEventHandler<HTMLInputElement> =>
      (event) => setter(event.target.value),
    [],
  );
  const secretInput = useCallback(
    (key: keyof SecretValues, setter: (value: string) => void) =>
      ((event) => {
        secrets.current[key] = event.target.value;
        setter(event.target.value);
      }) satisfies ChangeEventHandler<HTMLInputElement>,
    [],
  );
  const clearSecrets = useCallback(() => {
    secrets.current = {
      adminPassword: "",
      confirmation: "",
      mailboxPassword: "",
      otpCode: "",
    };
    setMailboxPassword("");
    setConfirmation("");
    setAdminPassword("");
    setOtpCode("");
  }, []);

  useEffect(
    () => () => {
      secrets.current = {
        adminPassword: "",
        confirmation: "",
        mailboxPassword: "",
        otpCode: "",
      };
      inFlight.current = false;
      idempotency.current = null;
    },
    [],
  );
  useEffect(() => {
    clearSecrets();
    setEmail("");
  }, [clearSecrets, selectedDomain]);

  const onSubmit: FormEventHandler<HTMLFormElement> = useCallback(
    async (event) => {
      event.preventDefault();
      if (inFlight.current || !available) return;
      const normalizedEmail = normalizeMailboxEmail(email, selectedDomain);
      if (!normalizedEmail) {
        onError(
          `Enter a mailbox address in ${selectedDomain || "an allowed domain"}.`,
        );
        clearSecrets();
        return;
      }
      const issue = passwordIssue(mailboxPassword, confirmation);
      if (issue || !adminPassword || (requiresOtp && !otpCode)) {
        onError(
          issue ??
            (requiresOtp && !otpCode
              ? "Enter the administrator authenticator or backup code."
              : "Enter the current administrator password."),
        );
        clearSecrets();
        return;
      }
      inFlight.current = true;
      setIsSubmitting(true);
      try {
        const fingerprint = await fingerprintMailboxIntent(
          normalizedEmail,
          displayName.trim(),
        );
        idempotency.current = idempotencyIntent(
          idempotency.current,
          fingerprint,
          () => globalThis.crypto.randomUUID(),
        );
        const result = await adminMailUsersApi.create(
          {
            confirmPassword: confirmation,
            currentAdminPassword: adminPassword,
            ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
            email: normalizedEmail,
            ...(requiresOtp ? { otpCode } : {}),
            password: mailboxPassword,
          },
          idempotency.current.key,
        );
        onCreated(result.user, selectedDomain);
        idempotency.current = null;
        setEmail("");
        setDisplayName("");
        onSuccess(
          result.replayed
            ? `Mailbox was already created by the first attempt. Its original password remains active; the re-entered password was not applied.${
                result.warning === "cache-invalidation-failed"
                  ? " Stalwart cache refresh also failed, so sign-in may be briefly delayed."
                  : ""
              }`
            : result.warning === "cache-invalidation-failed"
            ? "Mailbox created, but Stalwart cache refresh failed. Sign-in may be briefly delayed."
            : "Mailbox created successfully.",
        );
      } catch (caught) {
        if (isAdminSessionUnauthorized(caught)) {
          onUnauthorized();
        } else {
          onError(
            caught instanceof Error ? caught.message : "Unable to create mailbox.",
          );
        }
      } finally {
        clearSecrets();
        inFlight.current = false;
        setIsSubmitting(false);
      }
    },
    [
      adminPassword,
      available,
      clearSecrets,
      confirmation,
      displayName,
      email,
      mailboxPassword,
      onCreated,
      onError,
      onSuccess,
      onUnauthorized,
      otpCode,
      requiresOtp,
      selectedDomain,
    ],
  );

  return {
    adminPassword,
    adminPasswordInput: secretInput("adminPassword", setAdminPassword),
    confirmation,
    confirmationInput: secretInput("confirmation", setConfirmation),
    displayName,
    displayNameInput: input(setDisplayName),
    domain: selectedDomain,
    email,
    emailInput: input(setEmail),
    isAvailable: available,
    isSubmitting,
    mailboxPassword,
    mailboxPasswordInput: secretInput("mailboxPassword", setMailboxPassword),
    onSubmit,
    otpCode,
    otpCodeInput: secretInput("otpCode", setOtpCode),
    reason,
    requiresOtp,
  };
};
