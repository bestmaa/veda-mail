"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  EmailSignatureBook,
  EmailSignaturePutOperation,
} from "@/domain/member/email-signature";
import { optimisticEmailSignatureBook } from "@/presentation/features/mail-workspace/email-signature-book-optimistic";
import {
  MemberSignatureApiError,
  memberSignatureApi,
} from "@/transport/client/member-signature-api";
import {
  ignoreMailSessionFailure,
  type MailSessionFailureHandler,
} from "@/presentation/features/mail-workspace/hooks/mail-session-failure";

type WithoutExpectedRevision<T> = T extends unknown
  ? Omit<T, "expectedRevision">
  : never;

export type EmailSignatureMutation =
  WithoutExpectedRevision<EmailSignaturePutOperation>;

export type EmailSignaturesPhase =
  "error" | "idle" | "loading" | "ready" | "saving";

export interface EmailSignaturesModel {
  readonly book: EmailSignatureBook | null;
  readonly clearError: () => void;
  readonly error: string | null;
  readonly isLoading: boolean;
  readonly isSaving: boolean;
  readonly hasSessionChanged: boolean;
  readonly mutate: (
    mutation: EmailSignatureMutation,
  ) => Promise<EmailSignatureBook | null>;
  readonly phase: EmailSignaturesPhase;
  readonly retry: () => void;
}

const aborted = (error: unknown): boolean =>
  error instanceof DOMException && error.name === "AbortError";

const failureMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unable to update signatures.";

export const useEmailSignaturesModel = (
  accountKey: string,
  handleSessionFailure: MailSessionFailureHandler = ignoreMailSessionFailure,
): EmailSignaturesModel => {
  const [book, setBook] = useState<EmailSignatureBook | null>(null);
  const [bookAccountKey, setBookAccountKey] = useState("");
  const [phase, setPhase] = useState<EmailSignaturesPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [hasSessionChanged, setHasSessionChanged] = useState(false);
  const accountRef = useRef(accountKey);
  const bookRef = useRef<EmailSignatureBook | null>(null);
  const bookAccountKeyRef = useRef("");
  const generationRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const mutationAbortRef = useRef<AbortController | null>(null);
  const mutationSequenceRef = useRef(0);
  const mutationInFlightRef = useRef(false);

  const commitBook = useCallback(
    (next: EmailSignatureBook | null, ownerAccountKey: string) => {
      bookRef.current = next;
      bookAccountKeyRef.current = ownerAccountKey;
      setBook(next);
      setBookAccountKey(ownerAccountKey);
    },
    [],
  );

  const requestBook = useCallback(
    async (clearCurrent: boolean): Promise<EmailSignatureBook | null> => {
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
        const next = await memberSignatureApi.get(
          expectedAccount,
          controller.signal,
        );
        if (
          generation !== generationRef.current ||
          expectedAccount !== accountRef.current
        ) {
          return null;
        }
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
          nextError instanceof MemberSignatureApiError &&
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

  const mutate = useCallback(
    async (
      mutation: EmailSignatureMutation,
    ): Promise<EmailSignatureBook | null> => {
      const base = bookRef.current;
      if (
        !accountKey ||
        !base ||
        bookAccountKeyRef.current !== accountKey ||
        mutationInFlightRef.current
      ) {
        return null;
      }
      const operation = {
        ...mutation,
        expectedRevision: base.revision,
      } as EmailSignaturePutOperation;
      const expectedAccount = accountKey;
      loadAbortRef.current?.abort();
      const expectedGeneration = ++generationRef.current;
      const sequence = ++mutationSequenceRef.current;
      const controller = new AbortController();
      mutationAbortRef.current?.abort();
      mutationAbortRef.current = controller;
      mutationInFlightRef.current = true;
      commitBook(optimisticEmailSignatureBook(base, operation), expectedAccount);
      setError(null);
      setHasSessionChanged(false);
      setPhase("saving");
      try {
        const next = await memberSignatureApi.put(
          operation,
          expectedAccount,
          controller.signal,
        );
        if (
          expectedGeneration !== generationRef.current ||
          expectedAccount !== accountRef.current
        ) {
          return null;
        }
        commitBook(next, expectedAccount);
        setPhase("ready");
        return next;
      } catch (nextError) {
        if (
          aborted(nextError) ||
          expectedGeneration !== generationRef.current ||
          expectedAccount !== accountRef.current
        ) {
          return null;
        }
        commitBook(base, expectedAccount);
        if (handleSessionFailure(nextError)) return null;
        setHasSessionChanged(
          nextError instanceof MemberSignatureApiError &&
            nextError.code === "MAIL_SESSION_CHANGED",
        );
        if (
          nextError instanceof MemberSignatureApiError &&
          nextError.status === 409
        ) {
          const refreshed = await requestBook(false);
          if (refreshed && expectedAccount === accountRef.current) {
            setError(
              "Signatures changed in another tab. Review the latest settings and try again.",
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
    },
    [accountKey, commitBook, handleSessionFailure, requestBook],
  );

  const isCurrentAccount = bookAccountKey === accountKey;
  const visiblePhase: EmailSignaturesPhase = !accountKey
    ? "idle"
    : isCurrentAccount
      ? phase
      : "loading";
  return {
    book: isCurrentAccount ? book : null,
    clearError: () => {
      if (!hasSessionChanged) setError(null);
    },
    error: isCurrentAccount ? error : null,
    isLoading: visiblePhase === "loading",
    isSaving: visiblePhase === "saving",
    hasSessionChanged: isCurrentAccount && hasSessionChanged,
    mutate,
    phase: visiblePhase,
    retry: () => {
      void requestBook(false);
    },
  };
};
