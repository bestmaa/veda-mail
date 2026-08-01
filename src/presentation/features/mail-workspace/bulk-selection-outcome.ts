import type { MessageId } from "@/domain/shared/brand";
import { interruptedBulkMessageOutcomes,
  type BulkMessageAction } from "@/presentation/features/mail-workspace/bulk-message-operation";

interface OutcomeInput {
  readonly failed: readonly MessageId[];
  readonly messageIds: readonly MessageId[];
  readonly submitted: readonly MessageId[];
  readonly succeeded: readonly MessageId[];
  readonly unconfirmed: readonly MessageId[];
}

export interface BulkSelectionOutcome {
  readonly error: string | null;
  readonly pending: readonly MessageId[];
  readonly retry: readonly MessageId[];
  readonly shouldRefresh: boolean;
  readonly status: string;
}

const statusFor = (input: {
  readonly failed: number;
  readonly succeeded: number;
  readonly unconfirmed: number;
  readonly unconfirmedLabel?: string;
  readonly unsent: number;
  readonly verb: string;
}): string => {
  const parts = [`${input.succeeded} ${input.verb}`];
  if (input.failed) {
    parts.push(`${input.failed} failed, ${
      input.failed === 1 ? "was" : "were"
    } restored, and ${input.failed === 1 ? "remains" : "remain"} selected`);
  }
  if (input.unconfirmed) {
    parts.push(`${input.unconfirmed} ${
      input.unconfirmedLabel ?? "awaiting refresh confirmation"
    }${input.unconfirmedLabel ? ` and ${
      input.unconfirmed === 1 ? "remains" : "remain"
    } selected` : ""}`);
  }
  if (input.unsent) {
    parts.push(`${input.unsent} stopped before sending and ${
      input.unsent === 1 ? "remains" : "remain"
    } selected`);
  }
  return `${parts.join("; ")}.`;
};

export const completedBulkSelectionOutcome = (
  input: OutcomeInput & {
    readonly action: BulkMessageAction;
    readonly stopped: boolean;
  },
): BulkSelectionOutcome => {
  const outcomes = interruptedBulkMessageOutcomes({
    ...input,
    definiteRejection: false,
  });
  const unsent = input.stopped ? outcomes.unsent : [];
  const verb = input.action.type === "move" ? "moved" : "updated";
  const hasIncomplete = input.failed.length > 0 ||
    outcomes.unconfirmed.length > 0 || unsent.length > 0;
  return {
    error: outcomes.unconfirmed.length
      ? "Some updates could not be confirmed. Messages are being refreshed before retry."
      : null,
    pending: outcomes.unconfirmed,
    retry: [...input.failed, ...outcomes.unconfirmed, ...unsent],
    shouldRefresh: input.succeeded.length > 0 || outcomes.unconfirmed.length > 0,
    status: hasIncomplete
      ? statusFor({
          failed: input.failed.length,
          succeeded: input.succeeded.length,
          unconfirmed: outcomes.unconfirmed.length,
          unsent: unsent.length,
          verb,
        })
      : `${input.succeeded.length} ${
          input.succeeded.length === 1 ? "message" : "messages"
        } ${verb}.`,
  };
};

export const interruptedBulkSelectionOutcome = (
  input: OutcomeInput & {
    readonly definiteRejection: boolean;
    readonly errorMessage: string;
  },
): BulkSelectionOutcome => {
  const outcomes = interruptedBulkMessageOutcomes(input);
  return {
    error: input.definiteRejection
      ? input.errorMessage
      : "The update could not be confirmed. Messages are being refreshed before retry.",
    pending: outcomes.unconfirmed,
    retry: [
      ...outcomes.definiteFailures, ...outcomes.unconfirmed, ...outcomes.unsent,
    ],
    shouldRefresh: true,
    status: statusFor({
      failed: outcomes.definiteFailures.length,
      succeeded: input.succeeded.length,
      unconfirmed: outcomes.unconfirmed.length,
      unconfirmedLabel: "could not be confirmed",
      unsent: outcomes.unsent.length,
      verb: "updated",
    }),
  };
};
