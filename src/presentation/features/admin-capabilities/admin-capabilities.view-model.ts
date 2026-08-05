import type { ChangeEventHandler, FormEventHandler } from "react";

export interface AdminCapabilityRowViewModel {
  readonly effective: boolean;
  readonly effectiveLabel: string;
  readonly id: string;
  readonly label: string;
  readonly organizationLabel: string;
  readonly providerLabel: string;
}

export interface AdminPolicyControlViewModel {
  readonly checked: boolean;
  readonly description: string;
  readonly id: string;
  readonly label: string;
  readonly onChange: ChangeEventHandler<HTMLInputElement>;
}

export interface AdminCapabilitiesViewProps {
  readonly capabilities: readonly AdminCapabilityRowViewModel[];
  readonly error: string | null;
  readonly isLoading: boolean;
  readonly isSaving: boolean;
  readonly onSubmit: FormEventHandler<HTMLFormElement>;
  readonly policyControls: readonly AdminPolicyControlViewModel[];
  readonly providerName: string;
  readonly success: string | null;
}
