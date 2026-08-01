import type {
  BulkMessageMutation,
  MailWorkspace,
  MessageDetail,
  MessageSummary,
} from "@/domain/mail/mail";
import type { MailboxId, MessageId } from "@/domain/shared/brand";

export interface OptimisticMessageMutationContext {
  readonly activeMailboxId: MailboxId | null;
  readonly mutation: BulkMessageMutation;
}

export const messageIdsForMutation = (
  mutation: BulkMessageMutation,
): readonly MessageId[] => mutation.messageIds;

export const restrictMessageMutation = (
  mutation: BulkMessageMutation,
  messageIds: readonly MessageId[],
): BulkMessageMutation => ({ ...mutation, messageIds } as BulkMessageMutation);

export const isOptimisticMessageMutation = (
  mutation: BulkMessageMutation,
): boolean => mutation.type !== "destroy";

const projectSummary = (
  message: MessageSummary,
  mutation: BulkMessageMutation,
): MessageSummary => {
  if (mutation.type === "set-read") {
    return { ...message, isUnread: !mutation.value };
  }
  if (mutation.type === "set-starred") {
    return { ...message, isStarred: mutation.value };
  }
  if (mutation.type === "set-label") {
    const labelIds = mutation.value
      ? [...new Set([...message.labelIds, mutation.labelId])]
      : message.labelIds.filter((labelId) => labelId !== mutation.labelId);
    return { ...message, labelIds };
  }
  return message;
};

const removesFromSource = (mutation: BulkMessageMutation): boolean =>
  mutation.type === "archive" ||
  mutation.type === "delete" ||
  mutation.type === "restore" ||
  mutation.type === "move" ||
  mutation.type === "destroy";

const destinationRole = (
  mutation: BulkMessageMutation,
): "archive" | "inbox" | "trash" | null => {
  if (mutation.type === "archive") return "archive";
  if (mutation.type === "delete") return "trash";
  if (mutation.type === "restore") return "inbox";
  return null;
};

const membershipAfterMutation = (
  message: MessageSummary,
  mutation: BulkMessageMutation,
  workspace: MailWorkspace,
): ReadonlySet<MailboxId> | null => {
  if (mutation.type === "destroy") return new Set();
  if (mutation.type === "move") {
    const next = new Set(message.mailboxIds);
    next.delete(mutation.sourceMailboxId);
    next.add(mutation.destinationMailboxId);
    return next;
  }
  const role = destinationRole(mutation);
  if (!role) return null;
  const destination = workspace.mailboxes.find((mailbox) => mailbox.role === role);
  return destination ? new Set([destination.id]) : null;
};

export const projectOptimisticWorkspace = (
  workspace: MailWorkspace,
  context: OptimisticMessageMutationContext,
): MailWorkspace => {
  const requested = new Set(context.mutation.messageIds);
  const affected = workspace.messages.items.filter(({ id }) => requested.has(id));
  if (affected.length === 0) return workspace;

  const unreadDelta = new Map<MailboxId, number>();
  const totalDelta = new Map<MailboxId, number>();
  if (context.mutation.type === "set-read") {
    const nextUnread = !context.mutation.value;
    for (const message of affected) {
      if (message.isUnread === nextUnread) continue;
      const delta = nextUnread ? 1 : -1;
      for (const mailboxId of message.mailboxIds) {
        unreadDelta.set(mailboxId, (unreadDelta.get(mailboxId) ?? 0) + delta);
      }
    }
  } else if (removesFromSource(context.mutation)) {
    for (const message of affected) {
      const before = new Set(message.mailboxIds);
      const after = membershipAfterMutation(message, context.mutation, workspace);
      if (!after) continue;
      for (const mailboxId of before) {
        if (after.has(mailboxId)) continue;
        totalDelta.set(mailboxId, (totalDelta.get(mailboxId) ?? 0) - 1);
        if (message.isUnread) {
          unreadDelta.set(mailboxId, (unreadDelta.get(mailboxId) ?? 0) - 1);
        }
      }
      for (const mailboxId of after) {
        if (before.has(mailboxId)) continue;
        totalDelta.set(mailboxId, (totalDelta.get(mailboxId) ?? 0) + 1);
        if (message.isUnread) {
          unreadDelta.set(mailboxId, (unreadDelta.get(mailboxId) ?? 0) + 1);
        }
      }
    }
  }

  const removeRows = removesFromSource(context.mutation);
  const items = removeRows
    ? workspace.messages.items.filter(({ id }) => !requested.has(id))
    : workspace.messages.items.map((message) =>
        requested.has(message.id)
          ? projectSummary(message, context.mutation)
          : message,
      );
  return {
    ...workspace,
    mailboxes: workspace.mailboxes.map((mailbox) => ({
      ...mailbox,
      total: Math.max(0, mailbox.total + (totalDelta.get(mailbox.id) ?? 0)),
      unread: Math.max(0, mailbox.unread + (unreadDelta.get(mailbox.id) ?? 0)),
    })),
    messages: {
      ...workspace.messages,
      items,
      total: removeRows
        ? Math.max(0, workspace.messages.total - affected.length)
        : workspace.messages.total,
    },
  };
};

export const projectOptimisticMessage = (
  message: MessageDetail | null,
  mutation: BulkMessageMutation,
): MessageDetail | null => {
  if (!message || !mutation.messageIds.includes(message.id)) return message;
  if (removesFromSource(mutation)) return null;
  return projectSummary(message, mutation) as MessageDetail;
};
