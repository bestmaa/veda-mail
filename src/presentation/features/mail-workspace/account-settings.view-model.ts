import type { ChangeEventHandler, FormEventHandler } from "react";

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
}
