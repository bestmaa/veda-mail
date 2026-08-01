import type { BulkMessageMutationResult } from "@/domain/mail/mail";
import type { MessageId } from "@/domain/shared/brand";

export class AmbiguousBulkMutationResultError extends Error {
  public constructor() {
    super("The mail server response could not be confirmed. Refreshing messages.");
    this.name = "AmbiguousBulkMutationResultError";
  }
}

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

export const validateBulkMessageMutationResult = (
  value: unknown,
  requestedIds: readonly MessageId[],
): BulkMessageMutationResult => {
  if (!value || typeof value !== "object") {
    throw new AmbiguousBulkMutationResultError();
  }
  const candidate = value as {
    readonly failed?: unknown;
    readonly succeeded?: unknown;
    readonly unconfirmed?: unknown;
  };
  if (
    !isStringArray(candidate.failed) ||
    !isStringArray(candidate.succeeded) ||
    (candidate.unconfirmed !== undefined && !isStringArray(candidate.unconfirmed))
  ) {
    throw new AmbiguousBulkMutationResultError();
  }
  const requested = new Set<string>(requestedIds);
  const failed = new Set(candidate.failed);
  const succeeded = new Set(candidate.succeeded);
  const unconfirmedValues = candidate.unconfirmed ?? [];
  const unconfirmed = new Set(unconfirmedValues);
  if (
    requested.size !== requestedIds.length ||
    failed.size !== candidate.failed.length ||
    succeeded.size !== candidate.succeeded.length ||
    unconfirmed.size !== unconfirmedValues.length ||
    [...failed].some((messageId) => !requested.has(messageId)) ||
    [...succeeded].some(
      (messageId) => !requested.has(messageId) || failed.has(messageId),
    ) ||
    [...unconfirmed].some((messageId) => !failed.has(messageId)) ||
    failed.size + succeeded.size !== requested.size
  ) {
    throw new AmbiguousBulkMutationResultError();
  }
  const orderedUnconfirmed = requestedIds.filter((messageId) =>
    unconfirmed.has(messageId));
  return {
    failed: requestedIds.filter(
      (messageId) => failed.has(messageId) && !unconfirmed.has(messageId),
    ),
    succeeded: requestedIds.filter((messageId) => succeeded.has(messageId)),
    ...(orderedUnconfirmed.length ? { unconfirmed: orderedUnconfirmed } : {}),
  };
};
