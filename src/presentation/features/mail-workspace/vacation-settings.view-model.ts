import type { ChangeEventHandler, FormEventHandler } from "react";

export interface VacationSettingsViewModel {
  readonly capabilityReason: string | null;
  readonly delegationReason: string | null;
  readonly error: string | null;
  readonly fromDate: string;
  readonly fromDateInput: ChangeEventHandler<HTMLInputElement>;
  readonly isEnabled: boolean;
  readonly isLoading: boolean;
  readonly isSaving: boolean;
  readonly isSupported: boolean;
  readonly onEnabledChange: ChangeEventHandler<HTMLInputElement>;
  readonly onSubmit: FormEventHandler<HTMLFormElement>;
  readonly subject: string;
  readonly subjectInput: ChangeEventHandler<HTMLInputElement>;
  readonly success: string | null;
  readonly textBody: string;
  readonly textBodyInput: ChangeEventHandler<HTMLTextAreaElement>;
  readonly toDate: string;
  readonly toDateInput: ChangeEventHandler<HTMLInputElement>;
}
