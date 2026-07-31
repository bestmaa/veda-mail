"use client";

import { useCallback, useLayoutEffect, useRef } from "react";

interface DraftRequest {
  readonly accountKey: string;
  readonly controller: AbortController;
  readonly generation: number;
}

export const useComposerDraftRequest = (accountKey: string) => {
  const accountRef = useRef(accountKey);
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  useLayoutEffect(() => { accountRef.current = accountKey; }, [accountKey]);

  const invalidate = useCallback(() => {
    generation.current += 1;
    request.current?.abort();
    request.current = null;
  }, []);
  const isCurrent = useCallback((candidate: DraftRequest) =>
    generation.current === candidate.generation &&
    accountRef.current === candidate.accountKey, []);
  const begin = useCallback((): DraftRequest => {
    invalidate();
    const controller = new AbortController();
    request.current = controller;
    return { accountKey, controller, generation: generation.current };
  }, [accountKey, invalidate]);
  const finish = useCallback((candidate: DraftRequest): boolean => {
    if (!isCurrent(candidate)) return false;
    request.current = null;
    return true;
  }, [isCurrent]);

  return { begin, finish, invalidate, isCurrent };
};
