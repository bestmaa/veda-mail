import type {
  ChangeEventHandler,
  FormEventHandler,
} from "react";

export interface AdminMailUserListItemViewModel {
  readonly createdLabel: string;
  readonly displayName: string;
  readonly email: string;
  readonly id: string;
  readonly onOpen: () => void;
  readonly storageLabel: string;
}

export interface AdminMailUserDetailViewModel {
  readonly aliases: readonly string[];
  readonly createdLabel: string;
  readonly displayName: string;
  readonly email: string;
  readonly locale: string;
  readonly storageLabel: string;
  readonly timeZone: string;
}

export interface AdminMailUserCreateViewModel {
  readonly adminPassword: string;
  readonly adminPasswordInput: ChangeEventHandler<HTMLInputElement>;
  readonly confirmation: string;
  readonly confirmationInput: ChangeEventHandler<HTMLInputElement>;
  readonly displayName: string;
  readonly displayNameInput: ChangeEventHandler<HTMLInputElement>;
  readonly domain: string;
  readonly email: string;
  readonly emailInput: ChangeEventHandler<HTMLInputElement>;
  readonly isAvailable: boolean;
  readonly isSubmitting: boolean;
  readonly mailboxPassword: string;
  readonly mailboxPasswordInput: ChangeEventHandler<HTMLInputElement>;
  readonly onSubmit: FormEventHandler<HTMLFormElement>;
  readonly otpCode: string;
  readonly otpCodeInput: ChangeEventHandler<HTMLInputElement>;
  readonly reason: string | null;
  readonly requiresOtp: boolean;
}

export interface AdminMailUsersViewProps {
  readonly capabilityDescription: string | null;
  readonly capabilityTitle: string | null;
  readonly create: AdminMailUserCreateViewModel;
  readonly detail: AdminMailUserDetailViewModel | null;
  readonly domainInput: ChangeEventHandler<HTMLSelectElement>;
  readonly domains: readonly string[];
  readonly error: string | null;
  readonly isDetailLoading: boolean;
  readonly isLoading: boolean;
  readonly isLoadingMore: boolean;
  readonly items: readonly AdminMailUserListItemViewModel[];
  readonly nextCursor: string | null;
  readonly onLoadMore: () => void;
  readonly onRetry: () => void;
  readonly onSearch: FormEventHandler<HTMLFormElement>;
  readonly search: string;
  readonly searchInput: ChangeEventHandler<HTMLInputElement>;
  readonly selectedDomain: string;
  readonly status: "available" | "unconfigured" | "unsupported" | null;
  readonly success: string | null;
}
