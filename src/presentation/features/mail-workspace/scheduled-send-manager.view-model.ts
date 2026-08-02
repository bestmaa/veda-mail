import type { ScheduledMessage } from "@/domain/mail/scheduled-send";
import type { ChangeEventHandler } from "react";

export interface ScheduledSendManagerViewModel {
  readonly count: number;
  readonly error: string | null;
  readonly isLoading: boolean;
  readonly isAvailable: boolean;
  readonly isMutating: boolean;
  readonly isOpen: boolean;
  readonly messages: readonly ScheduledMessage[];
  readonly onCancelMessage: (message: ScheduledMessage) => void;
  readonly onClose: () => void;
  readonly onConfirmReschedule: () => void;
  readonly onOpen: () => void;
  readonly onRequestReschedule: (message: ScheduledMessage) => void;
  readonly onRescheduleCancel: () => void;
  readonly onRescheduleTimeInput: ChangeEventHandler<HTMLInputElement>;
  readonly onRetry: () => void;
  readonly rescheduleError: string | null;
  readonly rescheduleMaximum: string;
  readonly rescheduleMinimum: string;
  readonly rescheduleTarget: ScheduledMessage | null;
  readonly rescheduleTime: string;
  readonly timeZone: string;
}
