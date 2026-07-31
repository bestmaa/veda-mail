export interface ComposerRecoveryPromptViewModel {
  readonly description: string;
  readonly error: string | null;
  readonly hadLocalAttachments: boolean;
  readonly initialFocus: "primary" | "secondary";
  readonly isLoading: boolean;
  readonly isOpen: boolean;
  readonly onDismiss: () => void;
  readonly onPrimary: () => void;
  readonly onSecondary: () => void;
  readonly primaryLabel: string;
  readonly secondaryLabel: string;
  readonly title: string;
}
