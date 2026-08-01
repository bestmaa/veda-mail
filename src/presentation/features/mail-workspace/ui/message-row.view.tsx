import { Paperclip, Star } from "lucide-react";

import type { MessageItemViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";

export const MessageRowView = ({
  message,
}: {
  readonly message: MessageItemViewModel;
}) => (
  <article
    className={`group relative rounded-2xl border p-3.5 transition ${
      message.isSelected
        ? "border-indigo-300 bg-indigo-50 shadow-sm ring-1 ring-indigo-200"
        : message.isActive
        ? "border-indigo-200 bg-indigo-50/75 shadow-sm"
        : "border-transparent bg-white hover:border-slate-200 hover:shadow-sm"
    }`}
  >
    <div className="pointer-events-none relative flex items-start gap-3">
      {message.canSelect ? (
        <input
          aria-label={message.selectLabel}
          checked={message.isSelected}
          className="pointer-events-auto relative z-10 mt-1 size-6 shrink-0 accent-indigo-600"
          disabled={message.isSelectionDisabled}
          onChange={message.onToggleSelected}
          type="checkbox"
        />
      ) : null}
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
        {message.labels.length ? (
          <div aria-label="Message labels" className="mt-2 flex flex-wrap gap-1.5">
            {message.labels.map((label) => (
              <span
                className="rounded-full border px-2 py-0.5 text-[10px] font-bold"
                key={label.id}
                style={{ borderColor: label.color, color: label.color }}
              >
                {label.name}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
    <button
      aria-label={message.openLabel}
      className="absolute inset-0 rounded-2xl"
      onClick={message.onSelect}
      type="button"
    />
  </article>
);
