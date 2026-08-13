import type { ChangeEventHandler, FormEventHandler } from "react";
import type { DelegationEntry } from "@/domain/mail/delegation";

export interface VacationSettingsViewModel {
  readonly capabilityReason: string | null;
  readonly delegationReason: string | null;
  readonly delegationAccess: "manage" | "read";
  readonly delegationAccessInput: ChangeEventHandler<HTMLSelectElement>;
  readonly delegationEntries: readonly DelegationEntry[];
  readonly delegationIdentifier: string;
  readonly delegationIdentifierInput: ChangeEventHandler<HTMLInputElement>;
  readonly error: string | null;
  readonly fromDate: string;
  readonly fromDateInput: ChangeEventHandler<HTMLInputElement>;
  readonly isEnabled: boolean;
  readonly isDelegationSaving: boolean;
  readonly isDelegationSupported: boolean;
  readonly isLoading: boolean;
  readonly isSaving: boolean;
  readonly isSupported: boolean;
  readonly onEnabledChange: ChangeEventHandler<HTMLInputElement>;
  readonly onDelegationDelete: (identifier: string) => void;
  readonly onDelegationSubmit: FormEventHandler<HTMLFormElement>;
  readonly onSubmit: FormEventHandler<HTMLFormElement>;
  readonly subject: string;
  readonly subjectInput: ChangeEventHandler<HTMLInputElement>;
  readonly success: string | null;
  readonly textBody: string;
  readonly textBodyInput: ChangeEventHandler<HTMLTextAreaElement>;
  readonly toDate: string;
  readonly toDateInput: ChangeEventHandler<HTMLInputElement>;
}
