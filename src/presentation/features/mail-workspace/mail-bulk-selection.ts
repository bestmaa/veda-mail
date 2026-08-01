import type { MessageId } from "@/domain/shared/brand";

export const toggleBulkSelection = (
  selection: ReadonlySet<MessageId>,
  messageId: MessageId,
): ReadonlySet<MessageId> => {
  const next = new Set(selection);
  if (next.has(messageId)) next.delete(messageId);
  else next.add(messageId);
  return next;
};

export const selectLoadedMessages = (
  messageIds: readonly MessageId[],
): ReadonlySet<MessageId> => new Set(messageIds);

export const retainAvailableSelection = (
  selection: ReadonlySet<MessageId>,
  availableIds: ReadonlySet<MessageId>,
): ReadonlySet<MessageId> =>
  new Set([...selection].filter((messageId) => availableIds.has(messageId)));

export const retainFailedSelection = (
  selection: ReadonlySet<MessageId>,
  failedIds: readonly MessageId[],
): ReadonlySet<MessageId> => {
  const failed = new Set(failedIds);
  return new Set([...selection].filter((messageId) => failed.has(messageId)));
};
