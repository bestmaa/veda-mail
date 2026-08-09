export interface MailSearchFilterViewModel {
  readonly id: string;
  readonly label: string;
  readonly onRemove: () => void;
}

export interface MailSearchViewModel {
  readonly error: string | null;
  readonly filters: readonly MailSearchFilterViewModel[];
  readonly saved: SavedSearchesViewModel;
  readonly suggestions: readonly string[];
}

export interface SavedSearchItemViewModel {
  readonly id: string;
  readonly name: string;
  readonly onApply: () => void;
  readonly onDelete: () => void;
  readonly query: string;
}

export interface SavedSearchesViewModel {
  readonly canSave: boolean;
  readonly error: string | null;
  readonly isLoading: boolean;
  readonly isSaving: boolean;
  readonly items: readonly SavedSearchItemViewModel[];
  readonly name: string;
  readonly onNameChange: (value: string) => void;
  readonly onSave: () => void;
}
