import "server-only";

import type { LabelOwner } from "@/domain/mail/label";
import type { LabelId } from "@/domain/shared/brand";

const globalState = globalThis as typeof globalThis & {
  __vedaMailLabelOperationQueues?: Map<string, Promise<void>>;
};
globalState.__vedaMailLabelOperationQueues ??= new Map();

const operationKey = (owner: LabelOwner, labelId: LabelId): string =>
  JSON.stringify([owner.providerId, owner.email, labelId]);

export const withLabelOperation = async <T>(
  owner: LabelOwner,
  labelId: LabelId,
  task: () => Promise<T>,
): Promise<T> => {
  const key = operationKey(owner, labelId);
  const queue = globalState.__vedaMailLabelOperationQueues!;
  const previous = queue.get(key) ?? Promise.resolve();
  const result = previous.then(task, task);
  const tail = result.then(() => undefined, () => undefined);
  queue.set(key, tail);
  try {
    return await result;
  } finally {
    if (queue.get(key) === tail) queue.delete(key);
  }
};
