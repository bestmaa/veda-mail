import type {
  ChangeEventHandler,
  FormEventHandler,
} from "react";

export type SettingsFieldKind =
  | "email"
  | "password"
  | "select"
  | "text"
  | "url";

export interface MailServiceFieldViewModel {
  readonly autocomplete?: string;
  readonly help?: string;
  readonly kind: SettingsFieldKind;
  readonly label: string;
  readonly name: string;
  readonly onChange: ChangeEventHandler<HTMLInputElement | HTMLSelectElement>;
  readonly options: readonly {
    readonly label: string;
    readonly value: string;
  }[];
  readonly placeholder?: string;
  readonly required: boolean;
  readonly value: string;
}

export interface MailServiceProviderViewModel {
  readonly description: string;
  readonly id: string;
  readonly isSelected: boolean;
  readonly name: string;
  readonly onSelect: () => void;
}

export interface MailServiceStatusViewModel {
  readonly description: string;
  readonly label: string;
  readonly tone: "neutral" | "success";
}

export interface AdminMailServiceViewProps {
  readonly allowedDomains: string;
  readonly allowedDomainsInput: ChangeEventHandler<HTMLTextAreaElement>;
  readonly displayName: string;
  readonly displayNameInput: ChangeEventHandler<HTMLInputElement>;
  readonly error: string | null;
  readonly fields: readonly MailServiceFieldViewModel[];
  readonly isLoading: boolean;
  readonly isSaving: boolean;
  readonly onSubmit: FormEventHandler<HTMLFormElement>;
  readonly providers: readonly MailServiceProviderViewModel[];
  readonly saveLabel: string;
  readonly status: MailServiceStatusViewModel;
  readonly success: string | null;
}
