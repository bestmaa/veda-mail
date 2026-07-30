"use client";

import { type FormEvent, useCallback, useState } from "react";

import { createProviderFeatures } from "@/presentation/features/mail-workspace/account-settings-provider-features";
import type { AccountSettingsViewModel } from "@/presentation/features/mail-workspace/account-settings.view-model";
import type { EmailSignatureSettingsViewModel } from "@/presentation/features/mail-workspace/email-signature-settings.view-model";
import { useTwoFactorSettingsModel } from "@/presentation/features/mail-workspace/hooks/use-two-factor-settings-model";
import { useModalDialogFocus } from "@/presentation/shared/hooks/use-modal-dialog-focus";
import {
  memberSettingsApi,
  type MemberSettingsSnapshot,
} from "@/transport/client/api-client";

const defaultCapabilities = {
  mail: {
    maxAttachmentBytes: 0,
    maxAttachmentDownloadBytes: 0,
    supportsAttachmentDownload: false,
    supportsDrafts: false,
    supportsPasswordChange: false,
    supportsProfileSettings: false,
    supportsPush: false,
    supportsServerSearch: false,
    supportsThreads: false,
    supportsTwoFactorAuthentication: false,
  },
  passwordChange: false,
  profileSettings: false,
  twoFactorAuthentication: false,
};

export const useAccountSettingsModel = (
  fallbackEmail: string,
  fallbackName: string,
  signatures: EmailSignatureSettingsViewModel,
): AccountSettingsViewModel => {
  const [isOpen, setIsOpen] = useState(false);
  const [isCloseConfirmationOpen, setIsCloseConfirmationOpen] =
    useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [snapshot, setSnapshot] = useState<MemberSettingsSnapshot | null>(null);
  const [displayName, setDisplayName] = useState(fallbackName);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [isProfileSaving, setIsProfileSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [isPasswordSaving, setIsPasswordSaving] = useState(false);
  const {
    reset: resetTwoFactor,
    view: twoFactorView,
  } = useTwoFactorSettingsModel();
  const close = useCallback(() => {
    if (signatures.hasUnsavedChanges) {
      setIsCloseConfirmationOpen(true);
      return;
    }
    setIsOpen(false);
  }, [signatures.hasUnsavedChanges]);
  useModalDialogFocus(
    isOpen,
    "#account-settings-dialog",
    close,
    "[data-settings-initial-focus]",
  );

  const open = useCallback(() => {
    setIsCloseConfirmationOpen(false);
    setIsOpen(true);
    setIsLoading(true);
    setDisplayName(fallbackName);
    setProfileError(null);
    resetTwoFactor(false);
    void memberSettingsApi
      .get()
      .then((next) => {
        setSnapshot(next);
        setDisplayName(next.profile.displayName);
        resetTwoFactor(next.security.twoFactorEnabled);
      })
      .catch((error: unknown) => {
        setProfileError(
          error instanceof Error ? error.message : "Unable to load settings.",
        );
      })
      .finally(() => setIsLoading(false));
  }, [fallbackName, resetTwoFactor]);

  const onProfileSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setIsProfileSaving(true);
      setProfileError(null);
      setProfileSuccess(null);
      void memberSettingsApi
        .updateProfile(displayName)
        .then(({ profile }) => {
          setSnapshot((current) =>
            current ? { ...current, profile } : current,
          );
          setDisplayName(profile.displayName);
          setProfileSuccess("Profile name updated.");
        })
        .catch((error: unknown) => {
          setProfileError(
            error instanceof Error ? error.message : "Profile update failed.",
          );
        })
        .finally(() => setIsProfileSaving(false));
    },
    [displayName],
  );

  const onPasswordSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setIsPasswordSaving(true);
      setPasswordError(null);
      setPasswordSuccess(null);
      void memberSettingsApi
        .changePassword({
          confirmPassword,
          currentPassword,
          newPassword,
          ...(otpCode ? { otpCode } : {}),
        })
        .then(({ sessionActive }) => {
          if (!sessionActive) {
            window.location.assign("/");
            return;
          }
          setCurrentPassword("");
          setNewPassword("");
          setConfirmPassword("");
          setOtpCode("");
          setPasswordSuccess("Password changed successfully.");
        })
        .catch((error: unknown) => {
          setPasswordError(
            error instanceof Error ? error.message : "Password change failed.",
          );
        })
        .finally(() => setIsPasswordSaving(false));
    },
    [confirmPassword, currentPassword, newPassword, otpCode],
  );

  const capabilities = snapshot?.capabilities ?? defaultCapabilities;
  return {
    canChangePassword: capabilities.passwordChange,
    canEditProfile: capabilities.profileSettings,
    close,
    closeConfirmation: {
      description:
        "Closing account settings will discard unsaved signature changes.",
      isOpen: isCloseConfirmationOpen,
      onCancel: () => setIsCloseConfirmationOpen(false),
      onConfirm: () => {
        signatures.discardAll();
        setIsCloseConfirmationOpen(false);
        setIsOpen(false);
      },
      title: "Discard signature changes?",
    },
    displayName,
    email: snapshot?.profile.email ?? fallbackEmail,
    isLoading,
    isOpen,
    open,
    password: {
      confirm: confirmPassword,
      confirmInput: (event) => setConfirmPassword(event.target.value),
      current: currentPassword,
      currentInput: (event) => setCurrentPassword(event.target.value),
      error: passwordError,
      isSaving: isPasswordSaving,
      newValue: newPassword,
      newValueInput: (event) => setNewPassword(event.target.value),
      onSubmit: onPasswordSubmit,
      otpCode,
      otpCodeInput: (event) => setOtpCode(event.target.value),
      success: passwordSuccess,
    },
    profile: {
      displayNameInput: (event) => setDisplayName(event.target.value),
      error: profileError,
      isSaving: isProfileSaving,
      onSubmit: onProfileSubmit,
      success: profileSuccess,
    },
    profileName: snapshot?.profile.displayName ?? null,
    providerFeatures: createProviderFeatures(
      capabilities,
      snapshot?.attachmentCapability.status,
    ),
    signatures,
    twoFactor: {
      ...twoFactorView,
      canManage: capabilities.twoFactorAuthentication,
    },
  };
};
