import {
  Archive,
  Mail,
  MailOpen,
  Paperclip,
  Reply,
  ShieldCheck,
  Star,
  Trash2,
  X,
} from "lucide-react";

import type {
  ReaderViewModel,
} from "@/presentation/features/mail-workspace/mail-workspace.view-model";
import { AttachmentCardView } from "@/presentation/features/mail-workspace/ui/attachment-card.view";
import { ReaderActionView } from "@/presentation/features/mail-workspace/ui/reader-action.view";

interface MessageReaderViewProps {
  readonly onArchive: () => void;
  readonly onClose: () => void;
  readonly onDelete: () => void;
  readonly onReply: () => void;
  readonly onToggleRead: () => void;
  readonly onToggleStar: () => void;
  readonly reader: ReaderViewModel;
}

export const MessageReaderView = ({
  onArchive,
  onClose,
  onDelete,
  onReply,
  onToggleRead,
  onToggleStar,
  reader,
}: MessageReaderViewProps) => (
  <section className="flex min-h-0 flex-col bg-white">
    <div className="flex h-14 shrink-0 items-center gap-1 border-b border-slate-200 px-3 md:px-5">
      <ReaderActionView label="Back to message list" onClick={onClose}>
        <X aria-hidden size={18} />
      </ReaderActionView>
      <span className="mx-1 h-5 w-px bg-slate-200" />
      {reader.canArchive ? (
        <ReaderActionView label="Archive" onClick={onArchive}>
          <Archive aria-hidden size={18} />
        </ReaderActionView>
      ) : null}
      <ReaderActionView
        label={reader.isUnread ? "Mark as read" : "Mark as unread"}
        onClick={onToggleRead}
      >
        {reader.isUnread ? (
          <MailOpen aria-hidden size={18} />
        ) : (
          <Mail aria-hidden size={18} />
        )}
      </ReaderActionView>
      <ReaderActionView label="Delete" onClick={onDelete}>
        <Trash2 aria-hidden size={18} />
      </ReaderActionView>
      <span className="flex-1" />
      <ReaderActionView
        label={reader.isStarred ? "Remove star" : "Add star"}
        onClick={onToggleStar}
      >
        <Star
          aria-hidden
          className={reader.isStarred ? "fill-amber-400 text-amber-400" : ""}
          size={18}
        />
      </ReaderActionView>
    </div>

    <article
      aria-busy={reader.isLoading}
      aria-live="polite"
      className="min-h-0 flex-1 overflow-y-auto"
    >
      {reader.isLoading ? (
        <div className="animate-pulse p-6 md:p-9">
          <div className="h-7 w-3/5 rounded bg-slate-100" />
          <div className="mt-5 h-12 w-full rounded bg-slate-100" />
          <div className="mt-8 h-44 w-full rounded bg-slate-50" />
        </div>
      ) : null}
      {!reader.isLoading ? (
        <div className="mx-auto max-w-4xl p-5 md:p-9">
          {reader.error ? (
            <div
              className="mb-5 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-700"
              role="alert"
            >
              {reader.error}
            </div>
          ) : null}
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-600">
            <ShieldCheck aria-hidden size={14} />
            Sanitized message content
          </p>
          <h2 className="mt-2 text-2xl font-extrabold leading-tight tracking-[-0.04em] text-slate-900 md:text-[30px]">
            {reader.subject}
          </h2>
          <div className="mt-6 flex items-center gap-3 border-b border-slate-100 pb-6">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[#edeaff] text-sm font-extrabold text-[#4f46a5]">
              {reader.avatar}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-extrabold text-slate-800">
                {reader.from}
                <span className="ml-2 font-normal text-slate-400">
                  &lt;{reader.fromEmail}&gt;
                </span>
              </p>
              <p className="mt-0.5 text-xs text-slate-400">to {reader.to}</p>
            </div>
            <time className="hidden text-xs font-medium text-slate-400 sm:block">
              {reader.date}
            </time>
          </div>

          <div className="mail-body py-7 text-[15px] leading-7 text-slate-700">
            {reader.htmlBody ? (
              <iframe
                className="min-h-80 w-full border-0"
                sandbox=""
                srcDoc={reader.htmlBody}
                title="Email content"
              />
            ) : (
              <p className="whitespace-pre-wrap">{reader.body}</p>
            )}
          </div>

          {reader.attachments.length > 0 ? (
            <div className="border-t border-slate-100 pt-5">
              <p className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
                <Paperclip aria-hidden size={14} />
                Attachments
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {reader.attachments.map((attachment) => (
                  <AttachmentCardView
                    attachment={attachment}
                    key={attachment.id}
                  />
                ))}
              </div>
            </div>
          ) : null}

          <button
            className="mt-8 flex h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
            onClick={onReply}
            type="button"
          >
            <Reply aria-hidden size={17} />
            Reply
          </button>
        </div>
      ) : null}
    </article>
  </section>
);
