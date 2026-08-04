import type { ChangeEventHandler } from "react";
import type { SnoozedMessage, SnoozeStatus } from "@/domain/mail/snooze";

export interface MailSnoozeJobViewModel extends SnoozedMessage {
  readonly statusLabel: string;
  readonly wakeLabel: string;
}

export interface MailSnoozeViewModel {
  readonly canSnoozeBulk: boolean;
  readonly canSnoozeReader: boolean;
  readonly dialog: {
    readonly error: string | null;
    readonly confirmLabel: string;
    readonly isBusy: boolean;
    readonly isOpen: boolean;
    readonly localTime: string;
    readonly maximum: string;
    readonly minimum: string;
    readonly onCancel: () => void;
    readonly onConfirm: () => void;
    readonly onPreset: (value: string) => void;
    readonly onTimeInput: ChangeEventHandler<HTMLInputElement>;
    readonly presets: readonly { readonly id: string; readonly label: string; readonly resolved: string; readonly value: string }[];
    readonly resolvedUtc: string | null;
    readonly targetLabel: string;
    readonly timeZone: string;
  };
  readonly error: string | null;
  readonly isBusy: boolean;
  readonly isLoading: boolean;
  readonly jobs: readonly MailSnoozeJobViewModel[];
  readonly manager: { readonly close: () => void; readonly isOpen: boolean; readonly open: () => void };
  readonly onOpenBulk: () => void;
  readonly onOpenReader: () => void;
  readonly onReschedule: (job: MailSnoozeJobViewModel) => void;
  readonly onRestore: (snoozeId: string) => void;
  readonly onRetry: (snoozeId: string) => void;
  readonly pendingMessageIds: ReadonlySet<string>;
  readonly snoozedMailboxId: string | null;
  readonly supported: boolean;
}

export const snoozeStatusLabel = (status: SnoozeStatus): string => ({
  failed: "Needs attention", hiding: "Moving to Snoozed", "needs-auth": "Reconnect required",
  "retry-hide": "Retrying snooze", "retry-wake": "Retrying restore", snoozed: "Snoozed", waking: "Restoring",
})[status];
