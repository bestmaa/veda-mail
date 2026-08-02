export interface KeyboardShortcutsViewModel {
  readonly announcement: string;
  readonly dialog: {
    readonly enabled: boolean;
    readonly isOpen: boolean;
    readonly onClose: () => void;
  };
  readonly enabled: boolean;
  readonly onOpen: () => void;
}
