import {
  Inbox,
} from "lucide-react";

import type { MessageItemViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";
import { MessageListSkeletonView } from "@/presentation/features/mail-workspace/ui/message-list-skeleton.view";
import { MessageRowView } from "@/presentation/features/mail-workspace/ui/message-row.view";

interface MessageListViewProps {
  readonly activeFolder: string;
  readonly error: string | null;
  readonly isLoading: boolean;
  readonly messages: readonly MessageItemViewModel[];
  readonly total: number;
}

export const MessageListView = ({
  activeFolder,
  error,
  isLoading,
  messages,
  total,
}: MessageListViewProps) => (
  <section className="flex min-h-0 flex-col border-r border-slate-200 bg-[#f8f9fc]">
    <div className="border-b border-slate-200 bg-white px-4 pb-3 pt-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-indigo-500">
            Mailbox
          </p>
          <h1 className="mt-0.5 text-2xl font-extrabold tracking-[-0.04em] text-slate-900">
            {activeFolder}
          </h1>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
          {total} messages
        </span>
      </div>
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
        </div>
      ) : null}
    </div>
  </section>
);
