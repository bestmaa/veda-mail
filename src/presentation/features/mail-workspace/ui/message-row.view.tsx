import { FolderInput, GripVertical, Paperclip, Star } from "lucide-react";

import type { MessageItemViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";
import type { MessageListDensity } from "@/domain/mail/message-list-preferences";

const densityClasses = {
  compact: {
    avatar: "size-8",
    content: "gap-2",
    preview: "line-clamp-1 leading-4",
    row: "min-h-11 p-2",
  },
  comfortable: {
    avatar: "size-9",
    content: "gap-3",
    preview: "line-clamp-2 leading-5",
    row: "p-3.5",
  },
  spacious: {
    avatar: "size-10",
    content: "gap-4",
    preview: "line-clamp-2 leading-6",
    row: "p-5",
  },
} as const;

export const MessageRowView = ({
  message,
  density,
  showPreview,
}: {
  readonly density: MessageListDensity;
  readonly message: MessageItemViewModel;
  readonly showPreview: boolean;
}) => (
  <article
    className={`group relative rounded-2xl border transition ${
      densityClasses[density].row
    } ${
      message.isSelected
        ? "border-indigo-300 bg-indigo-50 shadow-sm ring-1 ring-indigo-200"
        : message.isActive
        ? "border-indigo-200 bg-indigo-50/75 shadow-sm"
        : "border-transparent bg-white hover:border-slate-200 hover:shadow-sm"
    }`}
    draggable={message.canDrag}
    onDragEnd={message.onDragEnd}
    onDragStart={message.onDragStart}
  >
    <div className={`pointer-events-none relative flex items-start ${
      densityClasses[density].content
    }`}>
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
        className={`grid shrink-0 place-items-center rounded-xl text-[11px] font-extrabold ${
          densityClasses[density].avatar
        } ${
          message.isUnread
            ? "bg-[#2f3274] text-white"
            : "bg-slate-100 text-slate-600"
        }`}
      >
        {message.avatar}
      </span>
      {message.canDrag ? (
        <GripVertical
          aria-hidden
          className="mt-2 shrink-0 text-slate-400"
          size={14}
        />
      ) : null}
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
        {showPreview && message.preview ? (
          <p className={`mt-1 text-xs text-slate-600 ${
            densityClasses[density].preview
          }`}>
            {message.preview}
          </p>
        ) : null}
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
      className="absolute inset-0 z-0 rounded-2xl"
      onClick={message.onSelect}
      type="button"
    />
    {message.canDrag ? (
      <button
        aria-label={`Move ${message.subject}`}
        className="absolute bottom-1 right-1 z-20 grid size-11 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 opacity-100 shadow-sm hover:border-indigo-200 hover:text-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 md:bottom-2 md:right-2 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
        onClick={message.onRequestMove}
        title={`Move ${message.subject}`}
        type="button"
      >
        <FolderInput aria-hidden size={16} />
      </button>
    ) : null}
  </article>
);
