"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SavedSearchBook, SavedSearchPutOperation } from "@/domain/mail/saved-search";
import type { MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import type { SavedSearchesViewModel } from "@/presentation/features/mail-workspace/mail-search.view-model";
import { MemberSavedSearchApiError, memberSavedSearchApi } from "@/transport/client/member-saved-search-api";

const message = (error: unknown): string => error instanceof Error
  ? error.message : "Saved searches are temporarily unavailable.";
type SavedSearchMutation = SavedSearchPutOperation extends infer T
  ? T extends SavedSearchPutOperation ? Omit<T, "expectedRevision"> : never
  : never;

export const useSavedSearchesModel = (
  sessionScope: string,
  activeQuery: string,
  apply: (query: string) => boolean,
  handleSessionFailure: MailSessionFailureHandler,
): SavedSearchesViewModel => {
  const [book, setBook] = useState<SavedSearchBook | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const generation = useRef(0);
  const scopeRef = useRef(sessionScope);

  const load = useCallback(async (scope: string): Promise<void> => {
    const currentGeneration = ++generation.current;
    if (!scope) { setBook(null); setError(null); setIsLoading(false); return; }
    setIsLoading(true); setError(null);
    try {
      const next = await memberSavedSearchApi.get(scope);
      if (currentGeneration === generation.current && scope === scopeRef.current) setBook(next);
    } catch (nextError) {
      if (currentGeneration !== generation.current || scope !== scopeRef.current) return;
      if (!handleSessionFailure(nextError)) setError(message(nextError));
    } finally {
      if (currentGeneration === generation.current) setIsLoading(false);
    }
  }, [handleSessionFailure]);

  useEffect(() => {
    scopeRef.current = sessionScope;
    void load(sessionScope);
    return () => { generation.current += 1; };
  }, [load, sessionScope]);

  const mutate = useCallback(async (operation: SavedSearchMutation) => {
    if (!sessionScope || !book || isSaving) return;
    setIsSaving(true); setError(null);
    try {
      const next = await memberSavedSearchApi.put({
        ...operation, expectedRevision: book.revision,
      } as SavedSearchPutOperation, sessionScope);
      if (sessionScope !== scopeRef.current) return;
      setBook(next);
      if (operation.operation === "create") setName("");
    } catch (nextError) {
      if (sessionScope !== scopeRef.current) return;
      if (handleSessionFailure(nextError)) return;
      if (nextError instanceof MemberSavedSearchApiError && nextError.status === 409) {
        setError("Saved searches changed in another tab. The latest list has been reloaded.");
        await load(sessionScope);
      } else setError(message(nextError));
    } finally {
      if (sessionScope === scopeRef.current) setIsSaving(false);
    }
  }, [book, handleSessionFailure, isSaving, load, sessionScope]);

  return {
    canSave: Boolean(activeQuery && name.trim() && book && !isLoading && !isSaving),
    error, isLoading, isSaving,
    items: (book?.searches ?? []).map((search) => ({
      id: search.id, name: search.name, onApply: () => { apply(search.query); },
      onDelete: () => { void mutate({ operation: "delete", searchId: search.id }); },
      query: search.query,
    })),
    name,
    onNameChange: (value) => { setName(value); setError(null); },
    onSave: () => { if (activeQuery && name.trim()) void mutate({
      name, operation: "create", query: activeQuery,
    }); },
  };
};
