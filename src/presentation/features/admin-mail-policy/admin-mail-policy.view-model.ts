import type { ChangeEventHandler, FormEventHandler } from "react";

export interface MailPolicyFieldViewModel {
  readonly description: string;
  readonly id: string;
  readonly label: string;
  readonly min?: number;
  readonly onChange: ChangeEventHandler<HTMLInputElement>;
  readonly type: "number" | "text";
  readonly value: number | string;
}

export interface AdminMailPolicyViewProps {
  readonly error: string | null;
  readonly fields: readonly MailPolicyFieldViewModel[];
  readonly isLoading: boolean;
  readonly isSaving: boolean;
  readonly onSubmit: FormEventHandler<HTMLFormElement>;
  readonly success: string | null;
}
