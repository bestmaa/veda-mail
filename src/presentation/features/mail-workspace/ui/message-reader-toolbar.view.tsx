import {
  Archive,
  Clock3,
  FolderInput,
  Mail,
  MailOpen,
  MessagesSquare,
  Printer,
  RotateCcw,
  Star,
  Tag,
  Trash2,
  X,
} from "lucide-react";

import type { MailboxRole } from "@/domain/mail/mail";
import type { ReaderViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";
import { ReaderActionView } from "@/presentation/features/mail-workspace/ui/reader-action.view";
import type { MailSnoozeViewModel } from "@/presentation/features/mail-workspace/mail-snooze.view-model";

interface Props {
  readonly activeRole: MailboxRole | null;
  readonly canPermanentlyDelete: boolean;
  readonly isBusy: boolean;
  readonly keyboardShortcutsEnabled?: boolean;
  readonly onArchive: () => void;
  readonly onClose: () => void;
  readonly onDelete: () => void;
  readonly onRequestMove: React.MouseEventHandler<HTMLButtonElement>;
  readonly onRequestDestroy: () => void;
  readonly onRestore: () => void;
  readonly onToggleRead: () => void;
  readonly onToggleStar: () => void;
  readonly reader: ReaderViewModel;
  readonly snooze?: MailSnoozeViewModel;
}

export const MessageReaderToolbarView = ({
  activeRole,
  canPermanentlyDelete,
  isBusy,
  keyboardShortcutsEnabled = false,
  onArchive,
  onClose,
  onDelete,
  onRequestMove,
  onRequestDestroy,
  onRestore,
  onToggleRead,
  onToggleStar,
  reader,
  snooze,
}: Props) => (
  <div className="flex h-14 shrink-0 items-center gap-1 overflow-x-auto border-b border-slate-200 px-3 md:px-5">
    <ReaderActionView
      label="Back to message list"
      onClick={onClose}
      shortcut={keyboardShortcutsEnabled ? "Escape" : undefined}
    >
      <X aria-hidden size={18} />
    </ReaderActionView>
    <span className="mx-1 h-5 w-px bg-slate-200" />
    {reader.canArchive ? (
      <ReaderActionView
        disabled={isBusy}
        label="Archive"
        onClick={onArchive}
        shortcut={keyboardShortcutsEnabled ? "E" : undefined}
      >
        <Archive aria-hidden size={18} />
      </ReaderActionView>
    ) : null}
    {snooze?.canSnoozeReader ? <ReaderActionView disabled={isBusy || snooze.isBusy} label="Snooze message" onClick={snooze.onOpenReader}><Clock3 aria-hidden size={18} /></ReaderActionView> : null}
    <ReaderActionView
      disabled={isBusy || reader.isLoading || !reader.messageId}
      label="Move message"
      onClick={onRequestMove}
    >
      <FolderInput aria-hidden size={18} />
    </ReaderActionView>
    <ReaderActionView
      label={reader.isUnread ? "Mark as read" : "Mark as unread"}
      disabled={isBusy}
      onClick={onToggleRead}
      shortcut={keyboardShortcutsEnabled ? "U" : undefined}
    >
      {reader.isUnread
        ? <MailOpen aria-hidden size={18} />
        : <Mail aria-hidden size={18} />}
    </ReaderActionView>
    {activeRole === "spam" || activeRole === "trash" ? (
      <ReaderActionView
        disabled={isBusy}
        label={activeRole === "spam" ? "Mark as not spam" : "Restore to Inbox"}
        onClick={onRestore}
      >
        <RotateCcw aria-hidden size={18} />
      </ReaderActionView>
    ) : null}
    {reader.labelActions?.applyOptions.length ? (
      <label className="relative hidden sm:block">
        <span className="sr-only">Apply label to message</span>
        <Tag aria-hidden className="pointer-events-none absolute left-2 top-2.5 text-slate-500" size={16} />
        <select
          aria-label="Apply label to message"
          className="h-9 max-w-36 rounded-lg border border-slate-200 bg-white pl-8 pr-6 text-xs font-semibold"
          defaultValue=""
          disabled={isBusy}
          onChange={(event) => {
            if (event.currentTarget.value) {
              reader.labelActions?.onApply(event.currentTarget.value);
            }
            event.currentTarget.value = "";
          }}
        >
          <option disabled value="">Apply label...</option>
          {reader.labelActions.applyOptions.map((label) => (
            <option key={label.id} value={label.id}>{label.name}</option>
          ))}
        </select>
      </label>
    ) : null}
    {reader.labelActions?.removeOptions.length ? (
      <label className="relative hidden md:block">
        <span className="sr-only">Remove label from message</span>
        <select
          aria-label="Remove label from message"
          className="h-9 max-w-36 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold"
          defaultValue=""
          disabled={isBusy}
          onChange={(event) => {
            if (event.currentTarget.value) {
              reader.labelActions?.onRemove(event.currentTarget.value);
            }
            event.currentTarget.value = "";
          }}
        >
          <option disabled value="">Remove label...</option>
          {reader.labelActions.removeOptions.map((label) => (
            <option key={label.id} value={label.id}>{label.name}</option>
          ))}
        </select>
      </label>
    ) : null}
    {activeRole === "spam" || activeRole === "trash" ? (
        <ReaderActionView
          disabled={isBusy || !canPermanentlyDelete}
          label={canPermanentlyDelete
            ? "Permanently delete"
            : "Permanent delete unavailable: provider permission required"}
          onClick={onRequestDestroy}
        >
        <Trash2 aria-hidden className="text-red-600" size={18} />
      </ReaderActionView>
    ) : (
      <ReaderActionView disabled={isBusy} label="Delete" onClick={onDelete}>
        <Trash2 aria-hidden size={18} />
      </ReaderActionView>
    )}
    <ReaderActionView
      disabled={isBusy || reader.isLoading || reader.print.isPreparing}
      label="Print message"
      onClick={reader.print.onPrintMessage}
    >
      <Printer aria-hidden size={18} />
    </ReaderActionView>
    {reader.print.canPrintConversation ? (
      <ReaderActionView
        disabled={isBusy || reader.isLoading || reader.print.isPreparing}
        label="Print conversation"
        onClick={reader.print.onPrintConversation}
      >
        <MessagesSquare aria-hidden size={18} />
      </ReaderActionView>
    ) : null}
    <span className="flex-1" />
    <ReaderActionView
      label={reader.isStarred ? "Remove star" : "Add star"}
      disabled={isBusy}
      onClick={onToggleStar}
      shortcut={keyboardShortcutsEnabled ? "S" : undefined}
    >
      <Star
        aria-hidden
        className={reader.isStarred ? "fill-amber-400 text-amber-400" : ""}
        size={18}
      />
    </ReaderActionView>
  </div>
);
