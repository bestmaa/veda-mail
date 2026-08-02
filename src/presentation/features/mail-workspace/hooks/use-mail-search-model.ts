"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEventHandler,
  type FormEventHandler,
} from "react";

import { MailSearchSyntaxError } from "@/domain/mail/mail-search";
import {
  MAX_MAIL_SEARCH_CHARACTERS,
  parseMailSearch,
  serializeMailSearch,
} from "@/domain/mail/mail-search-parser";

const MAX_RECENT_SEARCHES = 5;
const SEARCH_SUGGESTIONS = [
  "from:", "to:", "cc:", "subject:", "body:",
  "after:YYYY-MM-DD", "before:YYYY-MM-DD",
  "larger:1M", "smaller:10M", "has:attachment",
  "in:inbox", "in:sent", "in:drafts", "in:archive", "in:spam", "in:trash",
  "is:unread", "is:read", "is:starred", "is:unstarred",
] as const;

const searchFromFragment = (): string | null => {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.hash.slice(1)).get("search");
};

const replaceSearchFragment = (search: string): void => {
  if (typeof window === "undefined") return;
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  if (search) fragment.set("search", search);
  else fragment.delete("search");
  const next = fragment.toString();
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${window.location.search}${next ? `#${next}` : ""}`,
  );
};

const searchError = (error: unknown): string => error instanceof MailSearchSyntaxError
  ? error.message
  : "This mail search could not be applied.";

export const useMailSearchModel = (
  onApplied: (search: string) => void,
  canHydrate: boolean,
) => {
  const [inputValue, setInputValue] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<readonly string[]>([]);
  const hydrated = useRef(false);

  const apply = useCallback((raw: string, remember = true): boolean => {
    const value = raw.trim();
    if (!value) {
      setInputValue("");
      setAppliedSearch("");
      setError(null);
      replaceSearchFragment("");
      onApplied("");
      return true;
    }
    try {
      const parsed = parseMailSearch(value);
      setInputValue(parsed.canonical);
      setAppliedSearch(parsed.canonical);
      setError(null);
      replaceSearchFragment(parsed.canonical);
      if (remember) {
        setRecent((current) => [
          parsed.canonical,
          ...current.filter((item) => item !== parsed.canonical),
        ].slice(0, MAX_RECENT_SEARCHES));
      }
      onApplied(parsed.canonical);
      return true;
    } catch (nextError) {
      setError(searchError(nextError));
      return false;
    }
  }, [onApplied]);

  useEffect(() => {
    if (!canHydrate || hydrated.current) return;
    hydrated.current = true;
    const fragmentSearch = searchFromFragment();
    if (fragmentSearch !== null) apply(fragmentSearch, false);
  }, [apply, canHydrate]);

  const clear = useCallback(() => apply(""), [apply]);
  const reset = useCallback(() => {
    setInputValue("");
    setAppliedSearch("");
    setError(null);
    setRecent([]);
    replaceSearchFragment("");
  }, []);
  const onInput: ChangeEventHandler<HTMLInputElement> = useCallback((event) => {
    setInputValue(event.target.value);
    setError(null);
  }, []);
  const onSubmit: FormEventHandler<HTMLFormElement> = useCallback((event) => {
    event.preventDefault();
    apply(inputValue);
  }, [apply, inputValue]);
  const parsed = appliedSearch ? parseMailSearch(appliedSearch) : null;
  const remove = useCallback((index: number) => {
    if (!parsed) return;
    const remaining = parsed.criteria.filter((_, itemIndex) => itemIndex !== index);
    apply(serializeMailSearch(remaining));
  }, [apply, parsed]);
  const filters = parsed?.criteria.map((item, index) => {
    const label = serializeMailSearch([item]);
    return { id: `${index}:${label}`, label, onRemove: () => remove(index) };
  }) ?? [];

  return {
    appliedSearch,
    clear,
    inputValue,
    maxLength: MAX_MAIL_SEARCH_CHARACTERS,
    onInput,
    onSubmit,
    reset,
    viewModel: {
      error,
      filters,
      suggestions: [...recent, ...SEARCH_SUGGESTIONS]
        .filter((item, index, all) => all.indexOf(item) === index),
    },
  };
};
