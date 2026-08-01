import type { MailboxRole, MailWorkspace } from "@/domain/mail/mail";
import type { MailboxId, MessageId } from "@/domain/shared/brand";
import type { FolderViewModel, MessageItemViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";
import { formatMessageDate, formatSender, initials } from "@/presentation/shared/formatters/mail-formatters";
import { flattenMailboxTree } from "@/presentation/features/mail-workspace/mailbox-tree.view-model";

interface MailListOptions {
  readonly activeMailboxId: MailboxId | null;
  readonly draftsEnabled: boolean;
  readonly onOpenDraft: (id: string) => void;
  readonly onManageMailbox: (id: string) => void;
  readonly onSelectMailbox: (id: string) => void;
  readonly onSelectMessage: (id: string) => void;
  readonly onToggleMessage: (id: MessageId) => void;
  readonly selectedMessageIds: ReadonlySet<string>;
  readonly selectionDisabled: boolean;
  readonly selectedMessageId?: string;
  readonly workspace: MailWorkspace | null;
}

export const createMailListViewModel = ({
  activeMailboxId,
  draftsEnabled,
  onOpenDraft,
  onManageMailbox,
  onSelectMailbox,
  onSelectMessage,
  onToggleMessage,
  selectedMessageIds,
  selectionDisabled,
  selectedMessageId,
  workspace,
}: MailListOptions): {
  readonly activeFolder: string;
  readonly activeRole: MailboxRole | null;
  readonly folders: readonly FolderViewModel[];
  readonly messages: readonly MessageItemViewModel[];
} => {
  const activeMailbox = workspace?.mailboxes.find(
    ({ id }) => id === activeMailboxId,
  );
  const opensDrafts = draftsEnabled && activeMailbox?.role === "drafts";
  const labelById = new Map(
    (workspace?.labels ?? []).map((label) => [label.id, label] as const),
  );
  return {
    activeFolder: activeMailbox?.name ?? "Inbox",
    activeRole: activeMailbox?.role ?? null,
    folders: flattenMailboxTree(workspace?.mailboxes ?? []).map(({ depth, mailbox }) => ({
      canManage: mailbox.role === "custom" && mailbox.rights.mayRename,
      color: mailbox.color,
      count: mailbox.unread || mailbox.total,
      depth,
      id: mailbox.id,
      icon: mailbox.role,
      isActive: mailbox.id === activeMailboxId,
      label: mailbox.name,
      onManage: () => onManageMailbox(mailbox.id),
      onSelect: () => onSelectMailbox(mailbox.id),
    })),
    messages: (workspace?.messages.items ?? []).map((message) => {
      const subject = message.subject.trim() || "(No subject)";
      const sender = opensDrafts
        ? `To: ${message.to.length ? formatSender(message.to) : "No recipients"}`
        : formatSender(message.from);
      return {
        avatar: initials(sender),
        canSelect: !opensDrafts,
        date: formatMessageDate(message.receivedAt),
        hasAttachment: message.hasAttachment,
        id: message.id,
        isActive: !opensDrafts && message.id === selectedMessageId,
        isSelected: selectedMessageIds.has(message.id),
        isSelectionDisabled: selectionDisabled,
        isStarred: message.isStarred,
        isUnread: message.isUnread,
        labels: (message.labelIds ?? []).flatMap((labelId) => {
          const label = labelById.get(labelId);
          return label ? [label] : [];
        }),
        onSelect: () => opensDrafts
          ? onOpenDraft(message.id)
          : onSelectMessage(message.id),
        onToggleSelected: () => onToggleMessage(message.id),
        openLabel: opensDrafts ? `Edit draft ${subject}` : `Open ${subject}`,
        preview: message.preview,
        sender,
        selectLabel: `Select ${subject}`,
        subject,
      };
    }),
  };
};
