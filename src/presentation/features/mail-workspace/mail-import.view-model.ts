import type { ChangeEventHandler } from "react";

import type { MailRuleChoice } from "@/presentation/features/mail-workspace/mail-rules.view-model";

export interface MailImportViewModel {
  readonly error: string | null;
  readonly imported: number;
  readonly isImporting: boolean;
  readonly mailboxes: readonly MailRuleChoice[];
  readonly mailboxId: string;
  readonly mailboxInput: ChangeEventHandler<HTMLSelectElement>;
  readonly onFiles: ChangeEventHandler<HTMLInputElement>;
  readonly success: string | null;
  readonly total: number;
}
