import { Paperclip, Star } from "lucide-react";

import type { MessageItemViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";

export const MessageRowView = ({
  message,
}: {
  readonly message: MessageItemViewModel;
}) => (
  <article
    className={`group relative rounded-2xl border p-3.5 transition ${
      message.isActive
        ? "border-indigo-200 bg-indigo-50/75 shadow-sm"
        : "border-transparent bg-white hover:border-slate-200 hover:shadow-sm"
    }`}
  >
    <button
      aria-label={message.openLabel}
      className="absolute inset-0 rounded-2xl"
      onClick={message.onSelect}
      type="button"
    />
    <div className="pointer-events-none relative flex items-start gap-3">
      <span
        className={`grid size-9 shrink-0 place-items-center rounded-xl text-[11px] font-extrabold ${
          message.isUnread
            ? "bg-[#2f3274] text-white"
            : "bg-slate-100 text-slate-600"
        }`}
      >
        {message.avatar}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p
            className={`min-w-0 flex-1 truncate text-sm ${
              message.isUnread
                ? "font-extrabold text-slate-900"
                : "font-semibold text-slate-600"
            }`}
          >
            {message.sender}
          </p>
          <span className="text-[11px] font-medium text-slate-600">
            {message.date}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <p
            className={`min-w-0 flex-1 truncate text-[13px] ${
              message.isUnread
                ? "font-bold text-slate-800"
                : "font-medium text-slate-600"
            }`}
          >
            {message.subject}
          </p>
          {message.hasAttachment ? (
            <Paperclip aria-hidden className="text-slate-600" size={13} />
          ) : null}
          {message.isStarred ? (
            <Star
              aria-hidden
              className="fill-amber-400 text-amber-400"
              size={14}
            />
          ) : null}
        </div>
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">
          {message.preview}
        </p>
      </div>
    </div>
  </article>
);
