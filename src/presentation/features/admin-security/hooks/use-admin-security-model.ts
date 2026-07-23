"use client";

import {
  useCallback,
  useEffect,
  useState,
  type ChangeEventHandler,
  type FormEventHandler,
} from "react";

import type { AdminSecurityViewProps } from "@/presentation/features/admin-security/admin-security.view-model";

const parse = async (response: Response): Promise<{ readonly username: string }> => {
  const payload = (await response.json()) as {
    readonly data?: { readonly username: string };
    readonly error?: { readonly message?: string };
  };
  if (!response.ok || !payload.data) {
    throw new Error(payload.error?.message ?? "Unable to update administrator.");
  }
  return payload.data;
};

export const useAdminSecurityModel = (): AdminSecurityViewProps => {
  const [username, setUsername] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void fetch("/api/v1/admin/account")
      .then(parse)
      .then((snapshot) => {
        if (!alive) return;
        setUsername(snapshot.username);
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
  const onSubmit: FormEventHandler<HTMLFormElement> = useCallback(
    async (event) => {
      event.preventDefault();
      setError(null);
      setSuccess(null);
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
        const snapshot = await parse(
          await fetch("/api/v1/admin/account", {
            body: JSON.stringify({
              currentPassword,
              ...(newPassword ? { newPassword } : {}),
              username: username.trim(),
            }),
            headers: { "Content-Type": "application/json" },
            method: "PUT",
          }),
        );
        setUsername(snapshot.username);
        setCurrentPassword("");
        setNewPassword("");
        setConfirmation("");
        setSuccess("Administrator credentials updated.");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Unable to update administrator.");
      } finally {
        setIsSaving(false);
      }
    },
    [confirmation, currentPassword, newPassword, username],
  );
  return {
    confirmation,
    confirmationInput: input(setConfirmation),
    currentPassword,
    currentPasswordInput: input(setCurrentPassword),
    error,
    isLoading,
    isSaving,
    newPassword,
    newPasswordInput: input(setNewPassword),
    onSubmit,
    success,
    username,
    usernameInput: input(setUsername),
  };
};
