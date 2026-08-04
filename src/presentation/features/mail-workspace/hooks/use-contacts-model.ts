"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ContactBook,
  ContactGroupInput,
  ContactImportGroupInput,
  ContactInput,
  ContactPutOperation,
} from "@/domain/member/contact";
import type { ContactGroupId, ContactId } from "@/domain/shared/brand";
import {
  ignoreMailSessionFailure,
  type MailSessionFailureHandler,
} from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import {
  MemberContactApiError,
  memberContactApi,
} from "@/transport/client/member-contact-api";

type WithoutRevision<T> = T extends unknown
  ? Omit<T, "expectedRevision">
  : never;

export type ContactMutation = WithoutRevision<ContactPutOperation>;
export type ContactsPhase = "error" | "idle" | "loading" | "ready" | "saving";

export interface ContactsModel {
  readonly book: ContactBook | null;
  readonly clearError: () => void;
  readonly clearRecents: () => Promise<ContactBook | null>;
  readonly createContact: (contact: ContactInput) => Promise<ContactBook | null>;
  readonly createGroup: (group: ContactGroupInput) => Promise<ContactBook | null>;
  readonly deleteContact: (contactId: ContactId) => Promise<ContactBook | null>;
  readonly deleteGroup: (groupId: ContactGroupId) => Promise<ContactBook | null>;
  readonly error: string | null;
  readonly hasConflict: boolean;
  readonly hasSessionChanged: boolean;
  readonly importContacts: (
    contacts: readonly ContactInput[],
    groups?: readonly ContactImportGroupInput[],
  ) => Promise<ContactBook | null>;
  readonly isLoading: boolean;
  readonly isSaving: boolean;
  readonly phase: ContactsPhase;
  readonly retry: () => void;
  readonly updateContact: (
    contactId: ContactId,
    contact: ContactInput,
  ) => Promise<ContactBook | null>;
  readonly updateGroup: (
    groupId: ContactGroupId,
    group: ContactGroupInput,
  ) => Promise<ContactBook | null>;
}

const aborted = (error: unknown): boolean =>
  error instanceof DOMException && error.name === "AbortError";
const message = (error: unknown): string =>
  error instanceof Error ? error.message : "Unable to update contacts.";

export const optimisticContactBook = (
  book: ContactBook,
  operation: ContactPutOperation,
): ContactBook => {
  if (operation.expectedRevision !== book.revision) return book;
  if (operation.operation === "update-contact") return {
    ...book,
    contacts: book.contacts.map((contact) => contact.id === operation.contactId
      ? { ...contact, ...operation.contact }
      : contact),
  };
  if (operation.operation === "delete-contact") return {
    ...book,
    contacts: book.contacts.filter(({ id }) => id !== operation.contactId),
    groups: book.groups.flatMap((group) => {
      const contactIds = group.contactIds.filter(
        (contactId) => contactId !== operation.contactId,
      );
      return contactIds.length ? [{ ...group, contactIds }] : [];
    }),
  };
  if (operation.operation === "update-group") return {
    ...book,
    groups: book.groups.map((group) => group.id === operation.groupId
      ? { ...group, ...operation.group }
      : group),
  };
  if (operation.operation === "delete-group") return {
    ...book,
    groups: book.groups.filter(({ id }) => id !== operation.groupId),
  };
  if (operation.operation === "clear-recents") return { ...book, recents: [] };
  return book;
};

export const useContactsModel = (
  sessionScope: string,
  handleSessionFailure: MailSessionFailureHandler = ignoreMailSessionFailure,
): ContactsModel => {
  const [book, setBook] = useState<ContactBook | null>(null);
  const [bookScope, setBookScope] = useState("");
  const [phase, setPhase] = useState<ContactsPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [hasConflict, setHasConflict] = useState(false);
  const [hasSessionChanged, setHasSessionChanged] = useState(false);
  const scopeRef = useRef(sessionScope);
  const bookRef = useRef<ContactBook | null>(null);
  const bookScopeRef = useRef("");
  const generationRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const mutationAbortRef = useRef<AbortController | null>(null);
  const mutationSequenceRef = useRef(0);
  const mutationInFlightRef = useRef(false);

  const commit = useCallback((next: ContactBook | null, scope: string) => {
    bookRef.current = next;
    bookScopeRef.current = scope;
    setBook(next);
    setBookScope(scope);
  }, []);

  const load = useCallback(async (clear: boolean): Promise<ContactBook | null> => {
    const generation = ++generationRef.current;
    const expectedScope = sessionScope;
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    if (clear) commit(null, expectedScope);
    if (!expectedScope) {
      setError(null); setHasConflict(false); setHasSessionChanged(false);
      setPhase("idle");
      return null;
    }
    setError(null); setHasConflict(false); setHasSessionChanged(false);
    setPhase("loading");
    try {
      const next = await memberContactApi.get(expectedScope, controller.signal);
      if (generation !== generationRef.current ||
          expectedScope !== scopeRef.current) return null;
      commit(next, expectedScope);
      setPhase("ready");
      return next;
    } catch (nextError) {
      if (aborted(nextError) || generation !== generationRef.current) return null;
      if (handleSessionFailure(nextError)) return null;
      setError(message(nextError));
      setHasSessionChanged(nextError instanceof MemberContactApiError &&
        nextError.code === "MAIL_SESSION_CHANGED");
      setPhase("error");
      return null;
    }
  }, [commit, handleSessionFailure, sessionScope]);

  useEffect(() => {
    scopeRef.current = sessionScope;
    mutationAbortRef.current?.abort();
    mutationInFlightRef.current = false;
    void load(true);
    return () => {
      generationRef.current += 1;
      loadAbortRef.current?.abort();
      mutationAbortRef.current?.abort();
    };
  }, [load, sessionScope]);

  const mutate = useCallback(async (
    mutation: ContactMutation,
  ): Promise<ContactBook | null> => {
    const base = bookRef.current;
    if (!sessionScope || !base || bookScopeRef.current !== sessionScope ||
        mutationInFlightRef.current) return null;
    const operation = {
      ...mutation,
      expectedRevision: base.revision,
    } as ContactPutOperation;
    const expectedScope = sessionScope;
    loadAbortRef.current?.abort();
    const generation = ++generationRef.current;
    const sequence = ++mutationSequenceRef.current;
    const controller = new AbortController();
    mutationAbortRef.current?.abort();
    mutationAbortRef.current = controller;
    mutationInFlightRef.current = true;
    commit(optimisticContactBook(base, operation), expectedScope);
    setError(null); setHasConflict(false); setHasSessionChanged(false);
    setPhase("saving");
    try {
      const next = await memberContactApi.put(operation, expectedScope, controller.signal);
      if (generation !== generationRef.current ||
          expectedScope !== scopeRef.current) return null;
      commit(next, expectedScope);
      setPhase("ready");
      return next;
    } catch (nextError) {
      if (aborted(nextError) || generation !== generationRef.current ||
          expectedScope !== scopeRef.current) return null;
      commit(base, expectedScope);
      if (handleSessionFailure(nextError)) return null;
      setHasSessionChanged(nextError instanceof MemberContactApiError &&
        nextError.code === "MAIL_SESSION_CHANGED");
      if (nextError instanceof MemberContactApiError && nextError.status === 409) {
        const refreshed = await load(false);
        if (expectedScope === scopeRef.current) {
          setHasConflict(true);
          if (refreshed) setError(
            "Contacts changed in another tab. Review the latest address book and try again.",
          );
        }
        return null;
      }
      setError(message(nextError));
      setPhase("error");
      return null;
    } finally {
      if (sequence === mutationSequenceRef.current) {
        mutationInFlightRef.current = false;
      }
    }
  }, [commit, handleSessionFailure, load, sessionScope]);

  const current = bookScope === sessionScope;
  const visiblePhase: ContactsPhase = !sessionScope
    ? "idle" : current ? phase : "loading";
  return {
    book: current ? book : null,
    clearError: () => {
      if (!hasSessionChanged) { setError(null); setHasConflict(false); }
    },
    clearRecents: () => mutate({ operation: "clear-recents" }),
    createContact: (contact) => mutate({ contact, operation: "create-contact" }),
    createGroup: (group) => mutate({ group, operation: "create-group" }),
    deleteContact: (contactId) => mutate({ contactId, operation: "delete-contact" }),
    deleteGroup: (groupId) => mutate({ groupId, operation: "delete-group" }),
    error: current ? error : null,
    hasConflict: current && hasConflict,
    hasSessionChanged: current && hasSessionChanged,
    importContacts: (contacts, groups) => mutate({
      contacts, ...(groups ? { groups } : {}), operation: "import-contacts",
    }),
    isLoading: visiblePhase === "loading",
    isSaving: visiblePhase === "saving",
    phase: visiblePhase,
    retry: () => { void load(false); },
    updateContact: (contactId, contact) =>
      mutate({ contact, contactId, operation: "update-contact" }),
    updateGroup: (groupId, group) =>
      mutate({ group, groupId, operation: "update-group" }),
  };
};
