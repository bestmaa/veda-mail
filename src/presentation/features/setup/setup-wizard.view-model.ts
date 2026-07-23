import type {
  ChangeEventHandler,
  CSSProperties,
  FormEventHandler,
  ReactNode,
} from "react";

export type SetupStep = "admin" | "brand" | "mail" | "review" | "welcome";
export type SetupContent = ReactNode;

export interface SetupFieldViewModel {
  readonly help?: string;
  readonly kind: "email" | "password" | "select" | "text" | "url";
  readonly label: string;
  readonly name: string;
  readonly onChange: ChangeEventHandler<HTMLInputElement | HTMLSelectElement>;
  readonly options: readonly { readonly label: string; readonly value: string }[];
  readonly placeholder?: string;
  readonly required: boolean;
  readonly value: string;
}

export interface SetupProviderViewModel {
  readonly description: string;
  readonly id: string;
  readonly isSelected: boolean;
  readonly name: string;
  readonly onSelect: () => void;
}

export interface SetupStepViewModel {
  readonly id: SetupStep;
  readonly isActive: boolean;
  readonly label: string;
  readonly number: number;
}

export interface SetupWizardViewProps {
  readonly accentColor: string;
  readonly accentColorInput: ChangeEventHandler<HTMLInputElement>;
  readonly adminPassword: string;
  readonly adminPasswordConfirmation: string;
  readonly adminPasswordConfirmationInput: ChangeEventHandler<HTMLInputElement>;
  readonly adminPasswordInput: ChangeEventHandler<HTMLInputElement>;
  readonly adminUsername: string;
  readonly adminUsernameInput: ChangeEventHandler<HTMLInputElement>;
  readonly allowedDomains: string;
  readonly allowedDomainsInput: ChangeEventHandler<HTMLTextAreaElement>;
  readonly canGoBack: boolean;
  readonly error: string | null;
  readonly fields: readonly SetupFieldViewModel[];
  readonly isLoading: boolean;
  readonly isSubmitting: boolean;
  readonly logoFileName: string | null;
  readonly logoInput: ChangeEventHandler<HTMLInputElement>;
  readonly onBack: () => void;
  readonly onNext: () => void;
  readonly onSubmit: FormEventHandler<HTMLFormElement>;
  readonly organizationName: string;
  readonly organizationNameInput: ChangeEventHandler<HTMLInputElement>;
  readonly primaryColor: string;
  readonly primaryColorInput: ChangeEventHandler<HTMLInputElement>;
  readonly productName: string;
  readonly productNameInput: ChangeEventHandler<HTMLInputElement>;
  readonly publicRepositoryUrl: string;
  readonly publicRepositoryUrlInput: ChangeEventHandler<HTMLInputElement>;
  readonly providerDisplayName: string;
  readonly providerDisplayNameInput: ChangeEventHandler<HTMLInputElement>;
  readonly providers: readonly SetupProviderViewModel[];
  readonly setupToken: string;
  readonly setupTokenConfigured: boolean;
  readonly setupTokenInput: ChangeEventHandler<HTMLInputElement>;
  readonly step: SetupStep;
  readonly steps: readonly SetupStepViewModel[];
  readonly style: CSSProperties;
  readonly success: boolean;
}
