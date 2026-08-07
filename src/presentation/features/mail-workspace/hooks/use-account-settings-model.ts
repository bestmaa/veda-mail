"use client";
import { type FormEvent, useCallback, useLayoutEffect, useRef, useState } from "react";
import { DEFAULT_MEMBER_CAPABILITIES } from "@/presentation/features/mail-workspace/account-settings-default-capabilities";
import { createProviderFeatures } from "@/presentation/features/mail-workspace/account-settings-provider-features";
import { createAccountSettingsPolicy } from "@/presentation/features/mail-workspace/account-settings-policy";
import type { AccountSettingsViewModel } from "@/presentation/features/mail-workspace/account-settings.view-model";
import type { EmailSignatureSettingsViewModel } from "@/presentation/features/mail-workspace/email-signature-settings.view-model";
import type { MailRulesViewModel } from "@/presentation/features/mail-workspace/mail-rules.view-model"; import type { NewMailNotificationViewModel } from "@/presentation/features/mail-workspace/new-mail-notification.view-model";
import { useTwoFactorSettingsModel } from "@/presentation/features/mail-workspace/hooks/use-two-factor-settings-model";
import { useMemberSessionsModel } from "@/presentation/features/mail-workspace/hooks/use-member-sessions-model";
import {
  ignoreMailSessionFailure,
  type MailSessionFailureHandler,
} from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import { useModalDialogFocus } from "@/presentation/shared/hooks/use-modal-dialog-focus";
import {
  memberSettingsApi,
  type MemberSettingsSnapshot,
} from "@/transport/client/api-client";
export const useAccountSettingsModel = (
  fallbackEmail: string,
  fallbackName: string,
  signatures: EmailSignatureSettingsViewModel,
  sessionScope: string,
  rules: MailRulesViewModel,
  notifications: NewMailNotificationViewModel,
  handleSessionFailure: MailSessionFailureHandler = ignoreMailSessionFailure,
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
  const scopeRef = useRef(sessionScope);
  const { reset: resetTwoFactor, view: twoFactorView } =
    useTwoFactorSettingsModel(sessionScope, handleSessionFailure);
  const { load: loadMemberSessions, reset: resetMemberSessions,
    view: memberSessions } = useMemberSessionsModel(sessionScope, handleSessionFailure);
  useLayoutEffect(() => {
    scopeRef.current = sessionScope;
    setIsOpen(false);
    setIsCloseConfirmationOpen(false);
    setIsLoading(false);
    setSnapshot(null);
    setDisplayName(fallbackName);
    setProfileError(null);
    setProfileSuccess(null);
    setIsProfileSaving(false);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setOtpCode("");
    setPasswordError(null);
    setPasswordSuccess(null);
    setIsPasswordSaving(false);
    resetTwoFactor(false);
    resetMemberSessions();
  }, [fallbackName, handleSessionFailure, resetMemberSessions, resetTwoFactor, sessionScope]);
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
    loadMemberSessions();
    const requestScope = sessionScope;
    if (!requestScope) {
      setIsLoading(false);
      setProfileError("Mailbox settings are still loading.");
      return;
    }
    void memberSettingsApi
      .get(requestScope)
      .then((next) => {
        if (scopeRef.current !== requestScope) return;
        setSnapshot(next);
        setDisplayName(next.profile.displayName);
        resetTwoFactor(next.security.twoFactorEnabled);
      })
      .catch((error: unknown) => {
        if (scopeRef.current !== requestScope) return;
        if (handleSessionFailure(error)) return;
        setProfileError(
          error instanceof Error ? error.message : "Unable to load settings.",
        );
      })
      .finally(() => {
        if (scopeRef.current === requestScope) setIsLoading(false);
      });
  }, [fallbackName, handleSessionFailure, loadMemberSessions, resetTwoFactor, sessionScope]);
  const onProfileSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const requestScope = sessionScope;
      if (!requestScope) return;
      setIsProfileSaving(true);
      setProfileError(null);
      setProfileSuccess(null);
      void memberSettingsApi
        .updateProfile(displayName, requestScope)
        .then(({ profile }) => {
          if (scopeRef.current !== requestScope) return;
          setSnapshot((current) =>
            current ? { ...current, profile } : current,
          );
          setDisplayName(profile.displayName);
          setProfileSuccess("Profile name updated.");
        })
        .catch((error: unknown) => {
          if (scopeRef.current !== requestScope) return;
          if (handleSessionFailure(error)) return;
          setProfileError(
            error instanceof Error ? error.message : "Profile update failed.",
          );
        })
        .finally(() => {
          if (scopeRef.current === requestScope) setIsProfileSaving(false);
        });
    },
    [displayName, handleSessionFailure, sessionScope],
  );
  const onPasswordSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const requestScope = sessionScope;
      if (!requestScope) return;
      setIsPasswordSaving(true);
      setPasswordError(null);
      setPasswordSuccess(null);
      void memberSettingsApi
        .changePassword({
          confirmPassword,
          currentPassword,
          newPassword,
          ...(otpCode ? { otpCode } : {}),
        }, requestScope)
        .then(({ sessionActive }) => {
          if (scopeRef.current !== requestScope) return;
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
          if (scopeRef.current !== requestScope) return;
          if (handleSessionFailure(error)) return;
          setPasswordError(
            error instanceof Error ? error.message : "Password change failed.",
          );
        })
        .finally(() => {
          if (scopeRef.current === requestScope) setIsPasswordSaving(false);
        });
    },
    [confirmPassword, currentPassword, handleSessionFailure, newPassword, otpCode, sessionScope],
  );
  const capabilities =
    snapshot?.capabilities ?? DEFAULT_MEMBER_CAPABILITIES;
  const policyView = createAccountSettingsPolicy(snapshot);
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
    notifications,
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
    passwordPolicyRestricted: policyView.passwordRestricted,
    profile: {
      displayNameInput: (event) => setDisplayName(event.target.value),
      error: profileError,
      isSaving: isProfileSaving,
      onSubmit: onProfileSubmit,
      success: profileSuccess,
    },
    profilePolicyRestricted: policyView.profileRestricted,
    profileName: snapshot?.profile.displayName ?? null,
    providerFeatures: createProviderFeatures(
      capabilities,
      snapshot?.attachmentCapability.status,
    ),
    rules,
    sessions: memberSessions,
    signatures,
    twoFactor: {
      ...twoFactorView,
      canManage: capabilities.twoFactorAuthentication,
      disabledReason: policyView.twoFactorDisabledReason,
    },
  };
};
