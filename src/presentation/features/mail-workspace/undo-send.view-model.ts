export interface UndoSendViewModel {
  readonly error: string | null;
  readonly isUndoing: boolean;
  readonly isVisible: boolean;
  readonly onDismiss: () => void;
  readonly onUndo: () => void;
  readonly secondsRemaining: number;
  readonly subject: string;
}
