import type { ChangeEventHandler, FormEventHandler } from "react";
import type { MemberTwoFactorEnrollment } from "@/domain/member/member-settings";
import type {
  EmailSignatureConfirmationViewModel,
  EmailSignatureSettingsViewModel,
} from "@/presentation/features/mail-workspace/email-signature-settings.view-model";
import type { MailRulesViewModel } from "@/presentation/features/mail-workspace/mail-rules.view-model";
import type { NewMailNotificationViewModel } from "@/presentation/features/mail-workspace/new-mail-notification.view-model";

export interface AccountSettingsViewModel {
  readonly canChangePassword: boolean;
  readonly canEditProfile: boolean;
  readonly close: () => void;
  readonly closeConfirmation: EmailSignatureConfirmationViewModel;
  readonly displayName: string;
  readonly email: string;
  readonly isLoading: boolean;
  readonly isOpen: boolean;
  readonly notifications: NewMailNotificationViewModel;
  readonly open: () => void;
  readonly rules: MailRulesViewModel;
  readonly password: {
    readonly confirm: string;
    readonly confirmInput: ChangeEventHandler<HTMLInputElement>;
    readonly current: string;
    readonly currentInput: ChangeEventHandler<HTMLInputElement>;
    readonly error: string | null;
    readonly isSaving: boolean;
    readonly newValue: string;
    readonly newValueInput: ChangeEventHandler<HTMLInputElement>;
    readonly onSubmit: FormEventHandler<HTMLFormElement>;
    readonly otpCode: string;
    readonly otpCodeInput: ChangeEventHandler<HTMLInputElement>;
    readonly success: string | null;
  };
  readonly profile: {
    readonly displayNameInput: ChangeEventHandler<HTMLInputElement>;
    readonly error: string | null;
    readonly isSaving: boolean;
    readonly onSubmit: FormEventHandler<HTMLFormElement>;
    readonly success: string | null;
  };
  readonly profileName: string | null;
  readonly providerFeatures: readonly {
    readonly detail: string;
    readonly label: string;
    readonly supported: boolean;
  }[];
  readonly signatures: EmailSignatureSettingsViewModel;
  readonly twoFactor: {
    readonly cancelEnrollment: () => void;
    readonly canManage: boolean;
    readonly currentPassword: string;
    readonly currentPasswordInput: ChangeEventHandler<HTMLInputElement>;
    readonly copyRecoveryCodes: () => void;
    readonly enabled: boolean;
    readonly enrollment: MemberTwoFactorEnrollment | null;
    readonly error: string | null;
    readonly isSaving: boolean;
    readonly onDisable: FormEventHandler<HTMLFormElement>;
    readonly onEnable: FormEventHandler<HTMLFormElement>;
    readonly otpCode: string;
    readonly otpCodeInput: ChangeEventHandler<HTMLInputElement>;
    readonly recoveryCodes: readonly string[];
    readonly startEnrollment: () => void;
    readonly success: string | null;
  };
}
