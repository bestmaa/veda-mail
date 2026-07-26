import type { ChangeEventHandler, FormEventHandler } from "react";
import type { MemberTwoFactorEnrollment } from "@/domain/member/member-settings";

export interface AccountSettingsViewModel {
  readonly canChangePassword: boolean;
  readonly canEditProfile: boolean;
  readonly close: () => void;
  readonly displayName: string;
  readonly email: string;
  readonly isLoading: boolean;
  readonly isOpen: boolean;
  readonly open: () => void;
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
  readonly twoFactor: {
    readonly cancelEnrollment: () => void;
    readonly canManage: boolean;
    readonly currentPassword: string;
    readonly currentPasswordInput: ChangeEventHandler<HTMLInputElement>;
    readonly enabled: boolean;
    readonly enrollment: MemberTwoFactorEnrollment | null;
    readonly error: string | null;
    readonly isSaving: boolean;
    readonly onDisable: FormEventHandler<HTMLFormElement>;
    readonly onEnable: FormEventHandler<HTMLFormElement>;
    readonly otpCode: string;
    readonly otpCodeInput: ChangeEventHandler<HTMLInputElement>;
    readonly startEnrollment: () => void;
    readonly success: string | null;
  };
}
