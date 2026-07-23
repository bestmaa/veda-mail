import type {
  ChangeEventHandler,
  FormEventHandler,
} from "react";
import type { BrandingViewModel } from "@/presentation/shared/branding/branding.view-model";

export interface AdminLoginViewProps {
  readonly branding: BrandingViewModel;
  readonly error: string | null;
  readonly isSubmitting: boolean;
  readonly onPasswordInput: ChangeEventHandler<HTMLInputElement>;
  readonly onSubmit: FormEventHandler<HTMLFormElement>;
  readonly onUsernameInput: ChangeEventHandler<HTMLInputElement>;
  readonly password: string;
  readonly submitLabel: string;
  readonly username: string;
}
