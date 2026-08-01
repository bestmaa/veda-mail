"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { MailboxRole } from "@/domain/mail/mail";
import type { MailboxId } from "@/domain/shared/brand";
import type { MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import {
  createMailboxLifecycleCopy,
  type MailboxLifecycleViewModel,
} from "@/presentation/features/mail-workspace/mailbox-lifecycle.view-model";
import { runMailboxEmptyBatches } from "@/presentation/features/mail-workspace/mailbox-empty-runner";
import { mailApi } from "@/transport/client/api-client";

interface EmptyOperation {
  readonly mailboxId: MailboxId;
  readonly processed: number;
  readonly removed: number;
  readonly updatedAt: string;
}

interface Options {
  readonly activeMailboxId: MailboxId | null;
  readonly activeRole: MailboxRole | null;
  readonly bulkBusy: boolean;
  readonly handleSessionFailure: MailSessionFailureHandler;
  readonly hasActiveSearch: boolean;
  readonly operations: readonly EmptyOperation[];
  readonly mayRemoveItems: boolean;
  readonly refresh: () => void;
  readonly sessionScope: string;
  readonly total: number;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unable to empty this mailbox.";

export const useMailboxLifecycle = ({
  activeMailboxId,
  activeRole,
  bulkBusy,
  handleSessionFailure,
  hasActiveSearch,
  operations,
  mayRemoveItems,
  refresh,
  sessionScope,
  total,
}: Options): MailboxLifecycleViewModel => {
  const [isConfirming, setIsConfirming] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const scopeRef = useRef(sessionScope);
  const runIdRef = useRef(0);
  const inFlightRef = useRef(false);
  const resumeAttemptRef = useRef("");

  useEffect(() => {
    scopeRef.current = sessionScope;
    runIdRef.current += 1;
    inFlightRef.current = false;
    resumeAttemptRef.current = "";
    setIsConfirming(false);
    setIsBusy(false);
    setError(null);
    setStatus("");
  }, [sessionScope]);

  useEffect(() => setIsConfirming(false), [activeMailboxId]);

  const run = useCallback(async (
    mailboxId: MailboxId,
    initial: Pick<EmptyOperation, "processed" | "removed">,
    revealError: boolean,
  ) => {
    if (!sessionScope || inFlightRef.current) return;
    const requestScope = sessionScope;
    const runId = ++runIdRef.current;
    inFlightRef.current = true;
    setIsBusy(true);
    setIsConfirming(false);
    if (revealError) setError(null);
    try {
      await runMailboxEmptyBatches({
        emptyNextBatch: () => mailApi.emptyMailbox(mailboxId, requestScope),
        initial,
        isCurrent: () =>
          scopeRef.current === requestScope && runIdRef.current === runId,
        onProgress: (result) => setStatus(
          result.complete
            ? `${result.removed} ${result.removed === 1 ? "message" : "messages"} permanently deleted.`
            : `Emptying mailbox: ${result.removed} removed, ${result.processed} checked.`,
        ),
      });
      if (scopeRef.current !== requestScope || runIdRef.current !== runId) return;
      refresh();
    } catch (nextError) {
      if (scopeRef.current !== requestScope || runIdRef.current !== runId) return;
      if (!handleSessionFailure(nextError)) {
        setError(errorMessage(nextError));
        setStatus("Mailbox cleanup paused. Select Empty again to resume.");
      }
    } finally {
      if (scopeRef.current === requestScope && runIdRef.current === runId) {
        inFlightRef.current = false;
        setIsBusy(false);
      }
    }
  }, [handleSessionFailure, refresh, sessionScope]);

  useEffect(() => {
    const pending = operations.find(
      (operation) => operation.mailboxId === activeMailboxId,
    );
    if (!pending || !sessionScope || inFlightRef.current) return;
    const attempt = `${pending.mailboxId}:${pending.updatedAt}`;
    if (resumeAttemptRef.current === attempt) return;
    resumeAttemptRef.current = attempt;
    const timeout = window.setTimeout(() => {
      void run(pending.mailboxId, pending, false);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [activeMailboxId, operations, run, sessionScope]);

  const roleAllowsEmpty = activeRole === "spam" || activeRole === "trash";
  const canRequest = roleAllowsEmpty && Boolean(activeMailboxId) &&
    mayRemoveItems && !hasActiveSearch && total > 0 && !isBusy && !bulkBusy;
  const cancel = useCallback(() => setIsConfirming(false), []);
  const confirm = useCallback(() => {
    if (activeMailboxId && canRequest) {
      void run(activeMailboxId, { processed: 0, removed: 0 }, true);
    }
  }, [activeMailboxId, canRequest, run]);
  const requestEmpty = useCallback(() => {
    if (canRequest) setIsConfirming(true);
  }, [canRequest]);
  const copy = createMailboxLifecycleCopy({
    activeRole,
    error,
    hasActiveSearch,
    isBusy: isBusy || bulkBusy,
    isConfirming,
    mayRemoveItems,
    status,
    total,
  });
  return {
    ...copy,
    confirmation: { ...copy.confirmation, onCancel: cancel, onConfirm: confirm },
    onRequestEmpty: requestEmpty,
  };
};
