import type { BulkMessageMutation, MessageSummary } from "@/domain/mail/mail";
import type { MailboxId, MessageId } from "@/domain/shared/brand";
import type { MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import type { OptimisticMutationToken } from "@/presentation/features/mail-workspace/optimistic-message-state";

export interface MailBulkSelectionOptions {
  readonly activeMailboxId: MailboxId | null;
  readonly beginOptimisticMutation: (input: {
    readonly activeMailboxId: MailboxId | null;
    readonly mutation: BulkMessageMutation;
    readonly sessionScope: string;
    readonly viewKey: string;
  }) => OptimisticMutationToken | null;
  readonly currentViewRevision: () => number;
  readonly handleSessionFailure: MailSessionFailureHandler;
  readonly isCurrentScope: (scope: string) => boolean;
  readonly messages: readonly MessageSummary[];
  readonly optimisticPendingIds: ReadonlySet<MessageId>;
  readonly markOptimisticMutationUnconfirmed: (
    token: OptimisticMutationToken,
  ) => boolean;
  readonly refresh: () => void;
  readonly sessionScope: string;
  readonly settleOptimisticMutation: (
    token: OptimisticMutationToken,
    succeeded: readonly MessageId[],
    unconfirmed?: readonly MessageId[],
  ) => boolean;
  readonly viewKey: string;
}
