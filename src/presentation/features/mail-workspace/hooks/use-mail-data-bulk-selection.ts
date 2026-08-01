"use client";

import type { BulkMessageMutation, MailWorkspace } from "@/domain/mail/mail";
import type { MailboxId, MessageId } from "@/domain/shared/brand";
import type { MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import { useMailBulkSelection } from "@/presentation/features/mail-workspace/hooks/use-mail-bulk-selection";
import type { OptimisticMutationToken } from "@/presentation/features/mail-workspace/hooks/use-mail-session-scope-state";

const EMPTY_MESSAGES = [] as const;

interface MailDataBulkSelectionOptions {
  readonly activeMailboxId: MailboxId | null;
  readonly appliedSearch: string;
  readonly beginOptimisticMutation: (input: {
    readonly activeMailboxId: MailboxId | null;
    readonly mutation: BulkMessageMutation;
    readonly sessionScope: string;
    readonly viewKey: string;
  }) => OptimisticMutationToken | null;
  readonly currentViewRevision: () => number;
  readonly handleSessionFailure: MailSessionFailureHandler;
  readonly isCurrentScope: (scope: string) => boolean;
  readonly markOptimisticMutationUnconfirmed: (
    token: OptimisticMutationToken,
  ) => boolean;
  readonly optimisticPendingIds: ReadonlySet<MessageId>;
  readonly refresh: () => void;
  readonly sessionScope: string;
  readonly settleOptimisticMutation: (
    token: OptimisticMutationToken,
    succeeded: readonly MessageId[],
    unconfirmed?: readonly MessageId[],
  ) => boolean;
  readonly workspace: MailWorkspace | null;
}

export const useMailDataBulkSelection = ({
  activeMailboxId,
  appliedSearch,
  beginOptimisticMutation,
  currentViewRevision,
  handleSessionFailure,
  isCurrentScope,
  markOptimisticMutationUnconfirmed,
  optimisticPendingIds,
  refresh,
  sessionScope,
  settleOptimisticMutation,
  workspace,
}: MailDataBulkSelectionOptions) => {
  return useMailBulkSelection({
    activeMailboxId,
    beginOptimisticMutation,
    currentViewRevision,
    handleSessionFailure,
    isCurrentScope,
    messages: workspace?.messages.items ?? EMPTY_MESSAGES,
    optimisticPendingIds,
    markOptimisticMutationUnconfirmed,
    refresh,
    sessionScope,
    settleOptimisticMutation,
    viewKey: `${activeMailboxId ?? ""}\n${appliedSearch}\n${
      workspace?.messageListPreferences.sort ?? "newest"
    }`,
  });
};
