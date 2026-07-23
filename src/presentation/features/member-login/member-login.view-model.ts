import type {
  ChangeEventHandler,
  FormEventHandler,
} from "react";
import type { BrandingViewModel } from "@/presentation/shared/branding/branding.view-model";

export interface MemberLoginViewProps {
  readonly adminHref: string;
  readonly branding: BrandingViewModel;
  readonly email: string;
  readonly error: string | null;
  readonly isSubmitting: boolean;
  readonly onEmailInput: ChangeEventHandler<HTMLInputElement>;
  readonly onPasswordInput: ChangeEventHandler<HTMLInputElement>;
  readonly onSubmit: FormEventHandler<HTMLFormElement>;
  readonly password: string;
  readonly providerLabel: string;
  readonly submitLabel: string;
}
