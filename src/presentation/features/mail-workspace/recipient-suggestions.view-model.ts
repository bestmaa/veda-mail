import type { FocusEventHandler, KeyboardEventHandler } from "react";

import type { ContactSuggestion } from "@/presentation/features/mail-workspace/contact-suggestions";

export type RecipientFieldName = "bcc" | "cc" | "to";

export interface RecipientSuggestionFieldModel {
  readonly activeDescendant: string | undefined;
  readonly isOpen: boolean;
  readonly listboxId: string;
  readonly onBlur: FocusEventHandler<HTMLInputElement>;
  readonly onFocus: FocusEventHandler<HTMLInputElement>;
  readonly onKeyDown: KeyboardEventHandler<HTMLInputElement>;
  readonly onSelect: (suggestion: ContactSuggestion) => void;
  readonly onValueChange: () => void;
  readonly suggestions: readonly ContactSuggestion[];
}

export type RecipientSuggestionsModel = Readonly<
  Record<RecipientFieldName, RecipientSuggestionFieldModel>
>;

const emptyField = (name: RecipientFieldName): RecipientSuggestionFieldModel => ({
  activeDescendant: undefined,
  isOpen: false,
  listboxId: `composer-${name}-suggestions`,
  onBlur: () => undefined,
  onFocus: () => undefined,
  onKeyDown: () => undefined,
  onSelect: () => undefined,
  onValueChange: () => undefined,
  suggestions: [],
});

export const EMPTY_RECIPIENT_SUGGESTIONS: RecipientSuggestionsModel = {
  bcc: emptyField("bcc"),
  cc: emptyField("cc"),
  to: emptyField("to"),
};
