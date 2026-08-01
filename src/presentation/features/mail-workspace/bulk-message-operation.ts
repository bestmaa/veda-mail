import type { BulkMessageMutation } from "@/domain/mail/mail";
import type { LabelId, MailboxId, MessageId } from "@/domain/shared/brand";
import { chunkMessageIds, MOVE_BATCH_SIZE } from "@/presentation/features/mail-workspace/message-move-policy";
import { mailApi } from "@/transport/client/api-client";
import {
  AmbiguousBulkMutationResultError,
  validateBulkMessageMutationResult,
} from "@/transport/client/bulk-message-mutation-result";

export type BulkMessageAction =
  | { readonly type: "archive" | "delete" | "restore" }
  | { readonly type: "set-read" | "set-starred"; readonly value: boolean }
  | { readonly labelId: LabelId; readonly type: "set-label"; readonly value: boolean }
  | { readonly mailboxId: MailboxId; readonly type: "destroy" }
  | {
      readonly destinationMailboxId: MailboxId;
      readonly sourceMailboxId: MailboxId;
      readonly type: "move";
    };

export const MAX_BULK_MESSAGE_OPERATION_IDS = 2_000;

export const interruptedBulkMessageOutcomes = (input: {
  readonly definiteRejection: boolean;
  readonly failed: readonly MessageId[];
  readonly messageIds: readonly MessageId[];
  readonly submitted: readonly MessageId[];
  readonly succeeded: readonly MessageId[];
  readonly unconfirmed?: readonly MessageId[];
}): {
  readonly definiteFailures: readonly MessageId[];
  readonly unconfirmed: readonly MessageId[];
  readonly unsent: readonly MessageId[];
} => {
  const knownUnconfirmed = input.unconfirmed ?? [];
  const resolved = new Set([
    ...input.succeeded, ...input.failed, ...knownUnconfirmed,
  ]);
  const submitted = new Set(input.submitted);
  const unresolved = input.submitted.filter((messageId) => !resolved.has(messageId));
  const unsent = input.messageIds.filter((messageId) => !submitted.has(messageId));
  return input.definiteRejection
    ? {
        definiteFailures: [...input.failed, ...unresolved],
        unconfirmed: knownUnconfirmed,
        unsent,
      }
    : {
        definiteFailures: input.failed,
        unconfirmed: [...knownUnconfirmed, ...unresolved],
        unsent,
      };
};

export const bulkMessageOperationLimitError = (
  messageIds: readonly MessageId[],
): string | null => messageIds.length > MAX_BULK_MESSAGE_OPERATION_IDS
  ? `Update at most ${MAX_BULK_MESSAGE_OPERATION_IDS} messages at a time.`
  : null;

export const canStopBulkMessageOperation = (
  messageIds: readonly MessageId[],
): boolean => messageIds.length > MOVE_BATCH_SIZE;

export const mutationRequest = (
  action: BulkMessageAction,
  messageIds: readonly MessageId[],
): BulkMessageMutation => {
  if (action.type === "set-read" || action.type === "set-starred") {
    return { messageIds, type: action.type, value: action.value };
  }
  if (action.type === "set-label") {
    return { labelId: action.labelId, messageIds, type: action.type, value: action.value };
  }
  if (action.type === "destroy") {
    return { mailboxId: action.mailboxId, messageIds, type: action.type };
  }
  if (action.type === "move") {
    return {
      destinationMailboxId: action.destinationMailboxId,
      messageIds,
      sourceMailboxId: action.sourceMailboxId,
      type: action.type,
    };
  }
  return { messageIds, type: action.type };
};

export const runBulkMessageOperation = async (input: {
  readonly action: BulkMessageAction;
  readonly currentViewRevision: () => number;
  readonly expectedViewRevision: number;
  readonly failed: MessageId[];
  readonly isCurrent: () => boolean;
  readonly messageIds: readonly MessageId[];
  readonly shouldStop: () => boolean;
  readonly submitted: MessageId[];
  readonly succeeded: MessageId[];
  readonly sessionScope: string;
  readonly unconfirmed: MessageId[];
}): Promise<boolean> => {
  for (const batch of chunkMessageIds(input.messageIds)) {
    if (!input.isCurrent()) return false;
    if (input.shouldStop()) return true;
    if (input.currentViewRevision() !== input.expectedViewRevision) {
      throw new AmbiguousBulkMutationResultError();
    }
    input.submitted.push(...batch);
    const rawResult = await mailApi.mutateMessages(
      mutationRequest(input.action, batch),
      input.sessionScope,
    );
    const result = validateBulkMessageMutationResult(rawResult, batch);
    input.succeeded.push(...result.succeeded);
    input.failed.push(...result.failed);
    input.unconfirmed.push(...(result.unconfirmed ?? []));
    if (input.shouldStop()) return true;
  }
  if (input.currentViewRevision() !== input.expectedViewRevision) {
    throw new AmbiguousBulkMutationResultError();
  }
  return false;
};
