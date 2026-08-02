"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  EmailTemplate,
  EmailTemplateBook,
  EmailTemplatePutOperation,
} from "@/domain/member/email-template";
import {
  ignoreMailSessionFailure,
  type MailSessionFailureHandler,
} from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import {
  MemberTemplateApiError,
  memberTemplateApi,
} from "@/transport/client/member-template-api";

type WithoutExpectedRevision<T> = T extends unknown
  ? Omit<T, "expectedRevision">
  : never;

export type EmailTemplateMutation =
  WithoutExpectedRevision<EmailTemplatePutOperation>;
export type EmailTemplatesPhase =
  "error" | "idle" | "loading" | "ready" | "saving";

export interface EmailTemplatesModel {
  readonly book: EmailTemplateBook | null;
  readonly clearError: () => void;
  readonly error: string | null;
  readonly hasSessionChanged: boolean;
  readonly isLoading: boolean;
  readonly isSaving: boolean;
  readonly mutate: (
    mutation: EmailTemplateMutation,
  ) => Promise<EmailTemplateBook | null>;
  readonly phase: EmailTemplatesPhase;
  readonly retry: () => void;
}

const aborted = (error: unknown): boolean =>
  error instanceof DOMException && error.name === "AbortError";
const failureMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unable to update templates.";

const optimisticTemplate = (
  template: EmailTemplate,
  operation: Extract<EmailTemplatePutOperation, { operation: "update" }>,
): EmailTemplate => {
  if (template.id !== operation.templateId) return template;
  if (operation.content.mode === "plain") {
    const { htmlBody: _discarded, ...plain } = template;
    void _discarded;
    return {
      ...plain,
      body: operation.content.body,
      name: operation.name,
      subject: operation.content.subject,
    };
  }
  return {
    ...template,
    htmlBody: operation.content.htmlBody,
    name: operation.name,
    subject: operation.content.subject,
  };
};

const optimisticBook = (
  book: EmailTemplateBook,
  operation: EmailTemplatePutOperation,
): EmailTemplateBook => {
  if (operation.expectedRevision !== book.revision ||
      operation.operation === "create") return book;
  if (operation.operation === "update") {
    return {
      ...book,
      templates: book.templates.map((template) =>
        optimisticTemplate(template, operation)),
    };
  }
  return {
    ...book,
    templates: book.templates.filter(({ id }) => id !== operation.templateId),
  };
};

export const useEmailTemplatesModel = (
  accountKey: string,
  handleSessionFailure: MailSessionFailureHandler = ignoreMailSessionFailure,
): EmailTemplatesModel => {
  const [book, setBook] = useState<EmailTemplateBook | null>(null);
  const [bookAccountKey, setBookAccountKey] = useState("");
  const [phase, setPhase] = useState<EmailTemplatesPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [hasSessionChanged, setHasSessionChanged] = useState(false);
  const accountRef = useRef(accountKey);
  const bookRef = useRef<EmailTemplateBook | null>(null);
  const bookAccountKeyRef = useRef("");
  const generationRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const mutationAbortRef = useRef<AbortController | null>(null);
  const mutationSequenceRef = useRef(0);
  const mutationInFlightRef = useRef(false);

  const commitBook = useCallback(
    (next: EmailTemplateBook | null, ownerAccountKey: string) => {
      bookRef.current = next;
      bookAccountKeyRef.current = ownerAccountKey;
      setBook(next);
      setBookAccountKey(ownerAccountKey);
    },
    [],
  );

  const requestBook = useCallback(
    async (clearCurrent: boolean): Promise<EmailTemplateBook | null> => {
      const generation = ++generationRef.current;
      const expectedAccount = accountKey;
      loadAbortRef.current?.abort();
      const controller = new AbortController();
      loadAbortRef.current = controller;
      if (clearCurrent) commitBook(null, expectedAccount);
      if (!expectedAccount) {
        setError(null);
        setHasSessionChanged(false);
        setPhase("idle");
        return null;
      }
      setError(null);
      setHasSessionChanged(false);
      setPhase("loading");
      try {
        const next = await memberTemplateApi.get(
          expectedAccount,
          controller.signal,
        );
        if (generation !== generationRef.current ||
            expectedAccount !== accountRef.current) return null;
        commitBook(next, expectedAccount);
        setPhase("ready");
        return next;
      } catch (nextError) {
        if (aborted(nextError) || generation !== generationRef.current) {
          return null;
        }
        if (handleSessionFailure(nextError)) return null;
        setError(failureMessage(nextError));
        setHasSessionChanged(
          nextError instanceof MemberTemplateApiError &&
            nextError.code === "MAIL_SESSION_CHANGED",
        );
        setPhase("error");
        return null;
      }
    },
    [accountKey, commitBook, handleSessionFailure],
  );

  useEffect(() => {
    accountRef.current = accountKey;
    mutationAbortRef.current?.abort();
    mutationInFlightRef.current = false;
    void requestBook(true);
    return () => {
      generationRef.current += 1;
      loadAbortRef.current?.abort();
      mutationAbortRef.current?.abort();
    };
  }, [accountKey, requestBook]);

  const mutate = useCallback(async (
    mutation: EmailTemplateMutation,
  ): Promise<EmailTemplateBook | null> => {
    const base = bookRef.current;
    if (!accountKey || !base || bookAccountKeyRef.current !== accountKey ||
        mutationInFlightRef.current) return null;
    const operation = {
      ...mutation,
      expectedRevision: base.revision,
    } as EmailTemplatePutOperation;
    const expectedAccount = accountKey;
    loadAbortRef.current?.abort();
    const expectedGeneration = ++generationRef.current;
    const sequence = ++mutationSequenceRef.current;
    const controller = new AbortController();
    mutationAbortRef.current?.abort();
    mutationAbortRef.current = controller;
    mutationInFlightRef.current = true;
    commitBook(optimisticBook(base, operation), expectedAccount);
    setError(null);
    setHasSessionChanged(false);
    setPhase("saving");
    try {
      const next = await memberTemplateApi.put(
        operation, expectedAccount, controller.signal,
      );
      if (expectedGeneration !== generationRef.current ||
          expectedAccount !== accountRef.current) return null;
      commitBook(next, expectedAccount);
      setPhase("ready");
      return next;
    } catch (nextError) {
      if (aborted(nextError) || expectedGeneration !== generationRef.current ||
          expectedAccount !== accountRef.current) return null;
      commitBook(base, expectedAccount);
      if (handleSessionFailure(nextError)) return null;
      setHasSessionChanged(
        nextError instanceof MemberTemplateApiError &&
          nextError.code === "MAIL_SESSION_CHANGED",
      );
      if (nextError instanceof MemberTemplateApiError &&
          nextError.status === 409) {
        const refreshed = await requestBook(false);
        if (refreshed && expectedAccount === accountRef.current) {
          setError(
            "Templates changed in another tab. Review the latest settings and try again.",
          );
        }
        return null;
      }
      setError(failureMessage(nextError));
      setPhase("error");
      return null;
    } finally {
      if (sequence === mutationSequenceRef.current) {
        mutationInFlightRef.current = false;
      }
    }
  }, [accountKey, commitBook, handleSessionFailure, requestBook]);

  const isCurrentAccount = bookAccountKey === accountKey;
  const visiblePhase: EmailTemplatesPhase = !accountKey ? "idle"
    : isCurrentAccount ? phase : "loading";
  return {
    book: isCurrentAccount ? book : null,
    clearError: () => { if (!hasSessionChanged) setError(null); },
    error: isCurrentAccount ? error : null,
    hasSessionChanged: isCurrentAccount && hasSessionChanged,
    isLoading: visiblePhase === "loading",
    isSaving: visiblePhase === "saving",
    mutate,
    phase: visiblePhase,
    retry: () => { void requestBook(false); },
  };
};
