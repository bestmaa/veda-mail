import type { ChangeEventHandler } from "react";

export interface SettingsPortabilityViewModel {
  readonly cancelImport: () => void;
  readonly confirmImport: () => void;
  readonly error: string | null;
  readonly isExporting: boolean;
  readonly isImporting: boolean;
  readonly onExport: () => void;
  readonly onSelectFile: ChangeEventHandler<HTMLInputElement>;
  readonly pendingFileName: string | null;
  readonly success: string | null;
}
