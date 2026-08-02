import type { ChangeEventHandler } from "react";
export type { ScheduledSendManagerViewModel } from "@/presentation/features/mail-workspace/scheduled-send-manager.view-model";

export interface ComposerScheduleViewModel {
  readonly error: string | null;
  readonly isOpen: boolean;
  readonly isAvailable: boolean;
  readonly isScheduling: boolean;
  readonly localTime: string;
  readonly maximum: string;
  readonly minimum: string;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly onOpen: () => void;
  readonly onTimeInput: ChangeEventHandler<HTMLInputElement>;
  readonly timeZone: string;
}
