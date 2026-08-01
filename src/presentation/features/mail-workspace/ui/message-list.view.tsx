import {
  Check,
  Inbox,
  Minus,
} from "lucide-react";

import type { MessageItemViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";
import type { BulkActionsViewModel } from "@/presentation/features/mail-workspace/bulk-actions.view-model";
import type { MailboxRole } from "@/domain/mail/mail";
import type { MailboxLifecycleViewModel } from "@/presentation/features/mail-workspace/mailbox-lifecycle.view-model";
import { BulkActionsToolbarView } from "@/presentation/features/mail-workspace/ui/bulk-actions-toolbar.view";
import { MailboxLifecycleBannerView } from "@/presentation/features/mail-workspace/ui/mailbox-lifecycle-banner.view";
import { MessageListSkeletonView } from "@/presentation/features/mail-workspace/ui/message-list-skeleton.view";
import { MessageRowView } from "@/presentation/features/mail-workspace/ui/message-row.view";

interface MessageListViewProps {
  readonly activeFolder: string;
  readonly activeRole: MailboxRole | null;
  readonly bulkActions: BulkActionsViewModel;
  readonly error: string | null;
  readonly hasMore: boolean;
  readonly isLoading: boolean;
  readonly isLoadingMore: boolean;
  readonly loadMoreError: string | null;
  readonly mailboxLifecycle: MailboxLifecycleViewModel;
  readonly messages: readonly MessageItemViewModel[];
  readonly moveAnnouncement: string;
  readonly onLoadMore: () => void;
  readonly total: number;
}

export const MessageListView = ({
  activeFolder,
  activeRole,
  bulkActions,
  error,
  hasMore,
  isLoading,
  isLoadingMore,
  loadMoreError,
  mailboxLifecycle,
  messages,
  moveAnnouncement,
  onLoadMore,
  total,
}: MessageListViewProps) => (
  <section className="flex min-h-0 flex-col border-r border-slate-200 bg-[#f8f9fc]">
    <div className="border-b border-slate-200 bg-white px-4 pb-3 pt-4">
      <div className="flex items-end justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {messages.some((message) => message.canSelect) ? (
            <button
              aria-checked={
                bulkActions.selectedCount > 0 &&
                !bulkActions.allLoadedSelected
                  ? "mixed"
                  : bulkActions.allLoadedSelected
              }
              aria-label="Select all loaded messages"
              className="grid size-6 shrink-0 place-items-center rounded border border-slate-300 bg-white text-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-wait disabled:opacity-50"
              disabled={bulkActions.isBusy}
              onClick={bulkActions.onToggleAllLoaded}
              role="checkbox"
              type="button"
            >
              {bulkActions.allLoadedSelected ? (
                <Check aria-hidden size={14} />
              ) : bulkActions.selectedCount > 0 ? (
                <Minus aria-hidden size={14} />
              ) : null}
            </button>
          ) : null}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-indigo-500">
              Mailbox
            </p>
            <h1 className="mt-0.5 text-2xl font-extrabold tracking-[-0.04em] text-slate-900">
              {activeFolder}
            </h1>
          </div>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
          {total} messages
        </span>
      </div>
      {activeRole === "spam" || activeRole === "trash" ? (
        <MailboxLifecycleBannerView lifecycle={mailboxLifecycle} />
      ) : null}
      <BulkActionsToolbarView bulk={bulkActions} />
      {messages.some(({ canDrag }) => canDrag) ? (
        <p className="mt-2 text-xs leading-5 text-slate-500">
          Drag a message to a mailbox, or select messages and use Move to.
        </p>
      ) : null}
      <div aria-live="polite" className="sr-only">
        {[bulkActions.status, moveAnnouncement].filter(Boolean).join(" ")}
      </div>
      {bulkActions.error ? (
        <p className="mt-2 text-xs font-semibold text-red-700" role="alert">
          {bulkActions.error}
        </p>
      ) : null}
    </div>

    <div
      aria-busy={isLoading}
      aria-live="polite"
      className="min-h-0 flex-1 overflow-y-auto"
    >
      {isLoading ? <MessageListSkeletonView /> : null}
      {!isLoading && error ? (
        <div
          className="m-4 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-700"
          role="alert"
        >
          {error}
        </div>
      ) : null}
      {!isLoading && !error && messages.length === 0 ? (
        <div className="grid h-full min-h-72 place-items-center p-8 text-center">
          <div>
            <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-indigo-50 text-indigo-500">
              <Inbox aria-hidden size={24} />
            </span>
            <p className="mt-4 text-sm font-bold text-slate-700">
              Nothing here yet
            </p>
            <p className="mt-1 max-w-48 text-xs leading-5 text-slate-600">
              New messages matching this mailbox will appear here.
            </p>
          </div>
        </div>
      ) : null}
      {!isLoading && !error && messages.length > 0 ? (
        <div className="space-y-2 p-3">
          {messages.map((message) => (
            <MessageRowView key={message.id} message={message} />
          ))}
          {hasMore ? (
            <div className="flex flex-col items-center gap-2 py-3 text-center">
              <button
                aria-busy={isLoadingMore}
                className="min-h-11 rounded-xl border border-indigo-200 bg-white px-4 py-2 text-sm font-bold text-indigo-700 transition hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-wait disabled:opacity-60"
                disabled={isLoadingMore}
                onClick={onLoadMore}
                type="button"
              >
                {isLoadingMore ? "Loading more messages…" : "Load more messages"}
              </button>
              {loadMoreError ? (
                <p className="max-w-72 text-xs leading-5 text-red-700" role="alert">
                  {loadMoreError} Select Load more messages to retry.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  </section>
);
