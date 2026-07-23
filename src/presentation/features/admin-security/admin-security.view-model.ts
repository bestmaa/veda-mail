import type {
  ChangeEventHandler,
  FormEventHandler,
} from "react";

export interface AdminSecurityViewProps {
  readonly confirmation: string;
  readonly confirmationInput: ChangeEventHandler<HTMLInputElement>;
  readonly currentPassword: string;
  readonly currentPasswordInput: ChangeEventHandler<HTMLInputElement>;
  readonly error: string | null;
  readonly isLoading: boolean;
  readonly isSaving: boolean;
  readonly newPassword: string;
  readonly newPasswordInput: ChangeEventHandler<HTMLInputElement>;
  readonly onSubmit: FormEventHandler<HTMLFormElement>;
  readonly success: string | null;
  readonly username: string;
  readonly usernameInput: ChangeEventHandler<HTMLInputElement>;
}
