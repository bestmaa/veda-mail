"use client";

import { useCallback, useMemo, useState } from "react";

import type { ContactBook } from "@/domain/member/contact";
import {
  contactSuggestions,
  type ContactSuggestion,
} from "@/presentation/features/mail-workspace/contact-suggestions";
import type {
  RecipientFieldName,
  RecipientSuggestionFieldModel,
  RecipientSuggestionsModel,
} from "@/presentation/features/mail-workspace/recipient-suggestions.view-model";

interface ComposerRecipients {
  readonly bcc: string;
  readonly cc: string;
  readonly setRecipientField: (field: RecipientFieldName, value: string) => void;
  readonly to: string;
}

export const useRecipientSuggestionsModel = (
  book: ContactBook | null,
  composer: ComposerRecipients,
): RecipientSuggestionsModel => {
  const [activeField, setActiveField] = useState<RecipientFieldName | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const suggestions = {
    bcc: useMemo(() => contactSuggestions(book, composer.bcc), [book, composer.bcc]),
    cc: useMemo(() => contactSuggestions(book, composer.cc), [book, composer.cc]),
    to: useMemo(() => contactSuggestions(book, composer.to), [book, composer.to]),
  };

  const select = useCallback((
    field: RecipientFieldName,
    suggestion: ContactSuggestion,
  ) => {
    composer.setRecipientField(field, suggestion.replacement);
    setActiveField(field);
    setActiveIndex(-1);
  }, [composer]);

  const field = (name: RecipientFieldName): RecipientSuggestionFieldModel => {
    const items = suggestions[name];
    const isOpen = activeField === name && items.length > 0;
    const listboxId = `composer-${name}-suggestions`;
    return {
      activeDescendant: isOpen && activeIndex >= 0 && items[activeIndex]
        ? `${listboxId}-${activeIndex}`
        : undefined,
      isOpen,
      listboxId,
      onBlur: () => {
        setActiveField((current) => current === name ? null : current);
        setActiveIndex(-1);
      },
      onFocus: () => {
        setActiveField(name);
        setActiveIndex(-1);
      },
      onKeyDown: (event) => {
        if (event.key === "Escape") {
          setActiveField(null);
          setActiveIndex(-1);
          return;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          setActiveField(name);
          setActiveIndex((current) => {
            if (items.length === 0) return -1;
            if (event.key === "ArrowDown") return current >= items.length - 1 ? 0 : current + 1;
            return current <= 0 ? items.length - 1 : current - 1;
          });
          return;
        }
        if (event.key === "Enter" && activeField === name && activeIndex >= 0) {
          const suggestion = items[activeIndex];
          if (suggestion) {
            event.preventDefault();
            select(name, suggestion);
          }
          return;
        }
        if (event.key.length === 1) {
          setActiveField(name);
          setActiveIndex(-1);
        }
      },
      onSelect: (suggestion) => select(name, suggestion),
      onValueChange: () => {
        setActiveField(name);
        setActiveIndex(-1);
      },
      suggestions: items,
    };
  };

  return { bcc: field("bcc"), cc: field("cc"), to: field("to") };
};
