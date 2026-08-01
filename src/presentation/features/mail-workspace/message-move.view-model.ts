import type { MouseEventHandler } from "react";

export interface MessageMoveViewModel {
  readonly announcement: string;
  readonly dialog: {
    readonly count: number; readonly isOpen: boolean; readonly label: string;
    readonly onCancel: () => void; readonly onMove: (mailboxId: string) => void;
    readonly targets: readonly { readonly id: string; readonly label: string }[];
  };
  readonly onRequestReaderMove: MouseEventHandler<HTMLButtonElement>;
}
