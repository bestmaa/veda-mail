import { MessagesSquare } from "lucide-react";

import type { ConversationViewModel } from "@/presentation/features/mail-workspace/conversation.view-model";

export const MessageConversationView = ({
  conversation,
}: {
  readonly conversation: ConversationViewModel;
}) => {
  if (!conversation.isLoading && conversation.items.length <= 1 && !conversation.error) {
    return null;
  }
  return (
    <section
      aria-busy={conversation.isLoading || conversation.isLoadingMore}
      aria-label="Conversation"
      className="mb-6 rounded-2xl border border-slate-200 bg-slate-50/70 p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-2">
        <h3 className="flex items-center gap-2 text-sm font-extrabold text-slate-800">
          <MessagesSquare aria-hidden size={17} />
          Conversation
          {conversation.total > 0 ? ` · ${conversation.total}` : ""}
        </h3>
        <span className="text-[11px] font-semibold text-slate-500">
          {conversation.strategyLabel}
        </span>
      </div>
      {conversation.error ? (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {conversation.error}
        </p>
      ) : null}
      {conversation.isLoading ? (
        <p className="px-2 py-3 text-sm text-slate-600" role="status">
          Loading conversation…
        </p>
      ) : null}
      <ol className="space-y-2">
        {conversation.items.map((item) => (
          <li key={item.id}>
            <button
              aria-current={item.isActive ? "true" : undefined}
              className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                item.isActive
                  ? "border-indigo-200 bg-white shadow-sm"
                  : "border-transparent bg-white/70 hover:border-slate-200"
              }`}
              onClick={item.onOpen}
              type="button"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#edeaff] text-xs font-extrabold text-[#4f46a5]">
                {item.avatar}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-sm ${item.isUnread ? "font-extrabold" : "font-bold"}`}>
                  {item.sender}
                </span>
                <span className="block truncate text-xs font-semibold text-slate-700">
                  {item.subject}
                </span>
                {item.preview ? (
                  <span className="mt-0.5 block truncate text-xs text-slate-500">
                    {item.preview}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 text-[11px] font-medium text-slate-500">
                {item.date}
              </span>
            </button>
          </li>
        ))}
      </ol>
      {conversation.loadMore ? (
        <button
          className="mt-3 h-10 w-full rounded-xl border border-slate-200 bg-white text-sm font-bold text-indigo-700 disabled:cursor-wait disabled:opacity-60"
          disabled={conversation.isLoadingMore}
          onClick={conversation.loadMore}
          type="button"
        >
          {conversation.isLoadingMore ? "Loading…" : "Load more messages"}
        </button>
      ) : null}
      {conversation.truncated && !conversation.loadMore ? (
        <p className="mt-2 px-1 text-xs text-amber-700" role="status">
          This conversation is larger than the safe display limit.
        </p>
      ) : null}
    </section>
  );
};
