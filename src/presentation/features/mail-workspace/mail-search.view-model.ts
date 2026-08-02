export interface MailSearchFilterViewModel {
  readonly id: string;
  readonly label: string;
  readonly onRemove: () => void;
}

export interface MailSearchViewModel {
  readonly error: string | null;
  readonly filters: readonly MailSearchFilterViewModel[];
  readonly suggestions: readonly string[];
}
