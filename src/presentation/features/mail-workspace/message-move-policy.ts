import type { Mailbox } from "@/domain/mail/mailbox";
import type { MailboxId, MessageId } from "@/domain/shared/brand";
import { flattenMailboxTree } from "@/presentation/features/mail-workspace/mailbox-tree.view-model";

export const MOVE_BATCH_SIZE = 100;

export interface MessageMoveTarget {
  readonly id: MailboxId;
  readonly label: string;
}

const breadcrumbFor = (
  mailbox: Mailbox,
  mailboxById: ReadonlyMap<MailboxId, Mailbox>,
): string => {
  const labels = [mailbox.name];
  const visited = new Set<MailboxId>([mailbox.id]);
  let parentId = mailbox.parentId;
  while (parentId && !visited.has(parentId) && labels.length < 12) {
    visited.add(parentId);
    const parent = mailboxById.get(parentId);
    if (!parent) break;
    labels.unshift(parent.name);
    parentId = parent.parentId;
  }
  return labels.join(" / ");
};

export const messageMoveTargets = (
  mailboxes: readonly Mailbox[],
  sourceMailboxId: MailboxId | null,
): readonly MessageMoveTarget[] => {
  const source = mailboxes.find(({ id }) => id === sourceMailboxId);
  if (
    !source ||
    source.role === "drafts" ||
    source.rights.mayRemoveItems !== true
  ) {
    return [];
  }
  const lifecycleSource = source.role === "spam" || source.role === "trash";
  const mailboxById = new Map(mailboxes.map((mailbox) => [mailbox.id, mailbox]));
  return flattenMailboxTree(mailboxes)
    .map(({ mailbox }) => mailbox)
    .filter(
      (mailbox) =>
        mailbox.id !== source.id &&
        mailbox.role !== "drafts" &&
        mailbox.role !== "sent" &&
        mailbox.rights.mayAddItems === true &&
        (!lifecycleSource ||
          (mailbox.role !== "spam" && mailbox.role !== "trash")),
    )
    .map((mailbox) => ({
      id: mailbox.id,
      label: breadcrumbFor(mailbox, mailboxById),
    }));
};

export const resolveDraggedMessageIds = (
  messageId: MessageId,
  selectedIds: ReadonlySet<MessageId>,
): readonly MessageId[] =>
  selectedIds.has(messageId) ? [...new Set(selectedIds)] : [messageId];

export const chunkMessageIds = (
  messageIds: readonly MessageId[],
): readonly (readonly MessageId[])[] => {
  const unique = [...new Set(messageIds)];
  const chunks: MessageId[][] = [];
  for (let index = 0; index < unique.length; index += MOVE_BATCH_SIZE) {
    chunks.push(unique.slice(index, index + MOVE_BATCH_SIZE));
  }
  return chunks;
};
