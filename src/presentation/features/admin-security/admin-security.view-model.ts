import type {
  ChangeEventHandler,
  FormEventHandler,
} from "react";
import type { AdminSessionModel } from "@/presentation/features/admin-security/admin-session.view-model";

export interface AdminSecurityViewProps {
  readonly accountOtpCode: string;
  readonly accountOtpCodeInput: ChangeEventHandler<HTMLInputElement>;
  readonly confirmation: string;
  readonly confirmationInput: ChangeEventHandler<HTMLInputElement>;
  readonly currentPassword: string;
  readonly currentPasswordInput: ChangeEventHandler<HTMLInputElement>;
  readonly error: string | null;
  readonly isLoading: boolean;
  readonly isSaving: boolean;
  readonly isTwoFactorWorking: boolean;
  readonly newPassword: string;
  readonly newPasswordInput: ChangeEventHandler<HTMLInputElement>;
  readonly onSubmit: FormEventHandler<HTMLFormElement>;
  readonly onCopyRecoveryCodes: () => void;
  readonly onDisableTwoFactor: () => void;
  readonly onDismissRecoveryCodes: () => void;
  readonly onStartTwoFactor: () => void;
  readonly onTwoFactorSubmit: FormEventHandler<HTMLFormElement>;
  readonly recoveryCodes: readonly string[];
  readonly recoveryCodesRemaining: number;
  readonly recoveryConfigured: boolean;
  readonly sessions: AdminSessionModel;
  readonly success: string | null;
  readonly twoFactorCode: string;
  readonly twoFactorCodeInput: ChangeEventHandler<HTMLInputElement>;
  readonly twoFactorEnabled: boolean;
  readonly twoFactorEnrollment: {
    readonly qrDataUrl: string;
    readonly secret: string;
  } | null;
  readonly twoFactorPassword: string;
  readonly twoFactorPasswordInput: ChangeEventHandler<HTMLInputElement>;
  readonly username: string;
  readonly usernameInput: ChangeEventHandler<HTMLInputElement>;
}
