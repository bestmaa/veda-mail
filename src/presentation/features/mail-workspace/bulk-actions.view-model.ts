import type { MailWorkspace } from "@/domain/mail/mail";
import { id, type MailboxId, type MessageId } from "@/domain/shared/brand";
import type { useMailBulkSelection } from "@/presentation/features/mail-workspace/hooks/use-mail-bulk-selection";
import { messageMoveTargets } from "@/presentation/features/mail-workspace/message-move-policy";
import type { MailSnoozeViewModel } from "@/presentation/features/mail-workspace/mail-snooze.view-model";
import { MAX_MESSAGE_SOURCE_ARCHIVE_ENTRIES } from "@/domain/mail/message-source";

export interface BulkActionsViewModel {
  readonly allLoadedSelected: boolean;
  readonly canArchive: boolean;
  readonly canDestroy: boolean;
  readonly canExport?: boolean;
  readonly canRestore: boolean;
  readonly canSpam: boolean;
  readonly canSnooze?: boolean;
  readonly canStop: boolean;
  readonly canTrash: boolean;
  readonly destroyConfirmation: {
    readonly count: number;
    readonly isOpen: boolean;
    readonly onCancel: () => void;
    readonly onConfirm: () => void;
  };
  readonly error: string | null;
  readonly isBusy: boolean;
  readonly labels: readonly { readonly color: string; readonly id: string; readonly name: string }[];
  readonly moveTargets: readonly {
    readonly id: string;
    readonly label: string;
  }[];
  readonly onArchive: () => void;
  readonly onApplyLabel: (labelId: string) => void;
  readonly onClear: () => void;
  readonly onExport?: () => void;
  readonly onMarkRead: () => void;
  readonly onMarkUnread: () => void;
  readonly onMove: (mailboxId: string) => void;
  readonly onRequestDestroy: () => void;
  readonly onRemoveLabel: (labelId: string) => void;
  readonly onRestore: () => void;
  readonly onSpam: () => void;
  readonly onSnooze?: () => void;
  readonly onStar: () => void;
  readonly onStop: () => void;
  readonly onToggleAllLoaded: () => void;
  readonly onTrash: () => void;
  readonly onUnstar: () => void;
  readonly selectedCount: number;
  readonly restoreLabel: string;
  readonly spamLabel: string;
  readonly status: string;
}

interface BulkActionsOptions {
  readonly activeMailboxId: MailboxId | null;
  readonly bulk: ReturnType<typeof useMailBulkSelection>;
  readonly destroyConfirmation: {
    readonly isOpen: boolean;
    readonly onCancel: () => void;
    readonly onConfirm: () => void;
    readonly onRequest: () => void;
  };
  readonly workspace: MailWorkspace | null;
  readonly snooze?: MailSnoozeViewModel;
  readonly sourceArchive?: { readonly download: (ids: readonly MessageId[]) => void; readonly error: string | null; readonly isDownloading: boolean };
}

export const createBulkActionsViewModel = ({
  activeMailboxId,
  bulk,
  destroyConfirmation,
  sourceArchive,
  snooze,
  workspace,
}: BulkActionsOptions): BulkActionsViewModel => {
  const activeMailbox = workspace?.mailboxes.find(
    (mailbox) => mailbox.id === activeMailboxId,
  );
  const targetFor = (role: "archive" | "inbox" | "spam" | "trash") =>
    workspace?.mailboxes.find((mailbox) => mailbox.role === role) ?? null;
  const archiveTarget = targetFor("archive");
  const inboxTarget = targetFor("inbox");
  const spamTarget = targetFor("spam");
  const trashTarget = targetFor("trash");
  const disabled = activeMailbox?.role === "drafts";
  const sourceExport = sourceArchive ?? {
    download: () => undefined,
    error: null,
    isDownloading: false,
  };
  const lifecycleMailbox =
    activeMailbox?.role === "spam" || activeMailbox?.role === "trash";
  const deletingLabelIds = new Set(
    (workspace?.labelDeletions ?? []).map(({ labelId }) => labelId),
  );
  return {
    allLoadedSelected: !disabled && bulk.allLoadedSelected,
    canArchive:
      !disabled && !lifecycleMailbox && Boolean(archiveTarget) &&
      activeMailbox?.role !== "archive",
    canDestroy:
      activeMailbox?.rights.mayRemoveItems === true &&
      (activeMailbox.role === "spam" || activeMailbox.role === "trash"),
    canExport: !disabled && bulk.selectedIds.size <= MAX_MESSAGE_SOURCE_ARCHIVE_ENTRIES,
    canRestore:
      Boolean(inboxTarget) &&
      (activeMailbox?.role === "spam" || activeMailbox?.role === "trash"),
    canSpam: !disabled && !lifecycleMailbox && Boolean(spamTarget),
    canSnooze: snooze?.canSnoozeBulk ?? false,
    canStop: bulk.canStop,
    canTrash: !disabled && !lifecycleMailbox && Boolean(trashTarget),
    destroyConfirmation: {
      count: bulk.selectedIds.size,
      isOpen: destroyConfirmation.isOpen,
      onCancel: destroyConfirmation.onCancel,
      onConfirm: destroyConfirmation.onConfirm,
    },
    error: bulk.error ?? sourceExport.error,
    isBusy: bulk.isBusy || sourceExport.isDownloading,
    labels: workspace?.labelCapability === "supported"
      ? workspace.labels.filter(({ id: labelId }) =>
          !deletingLabelIds.has(labelId),
        )
      : [],
    moveTargets: messageMoveTargets(
      workspace?.mailboxes ?? [],
      activeMailbox?.id ?? null,
    ),
    onArchive: () => void bulk.mutate({ type: "archive" }),
    onApplyLabel: (labelId: string) =>
      void bulk.mutate({ labelId: id.label(labelId), type: "set-label", value: true }),
    onClear: bulk.clear,
    onExport: () => void sourceExport.download([...bulk.selectedIds]),
    onMarkRead: () =>
      void bulk.mutate({ type: "set-read", value: true }),
    onMarkUnread: () =>
      void bulk.mutate({ type: "set-read", value: false }),
    onMove: (mailboxId: string) =>
      activeMailbox
        ? void bulk.mutate({
            destinationMailboxId: id.mailbox(mailboxId),
            sourceMailboxId: activeMailbox.id,
            type: "move",
          })
        : undefined,
    onRequestDestroy: destroyConfirmation.onRequest,
    onRemoveLabel: (labelId: string) =>
      void bulk.mutate({ labelId: id.label(labelId), type: "set-label", value: false }),
    onRestore: () => void bulk.mutate({ type: "restore" }),
    onSpam: () => {
      if (spamTarget && activeMailbox) {
        void bulk.mutate({
          destinationMailboxId: spamTarget.id,
          sourceMailboxId: activeMailbox.id,
          type: "move",
        });
      }
    },
    onSnooze: snooze?.onOpenBulk ?? (() => undefined),
    onStar: () =>
      void bulk.mutate({ type: "set-starred", value: true }),
    onStop: bulk.stop,
    onToggleAllLoaded: bulk.toggleAllLoaded,
    onTrash: () => void bulk.mutate({ type: "delete" }),
    onUnstar: () =>
      void bulk.mutate({ type: "set-starred", value: false }),
    selectedCount: disabled ? 0 : bulk.selectedIds.size,
    restoreLabel: activeMailbox?.role === "spam"
      ? "Mark selected messages as not spam"
      : "Restore selected messages from Trash to Inbox",
    spamLabel: "Move selected messages to Spam",
    status: sourceExport.isDownloading
      ? `Exporting ${bulk.selectedIds.size} selected messages…`
      : bulk.status,
  };
};
