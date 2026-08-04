import { Forward, Reply, ReplyAll, ShieldCheck } from "lucide-react";

import type {
  ReaderViewModel,
} from "@/presentation/features/mail-workspace/mail-workspace.view-model";
import type { MailboxRole } from "@/domain/mail/mail";
import { AttachmentPreviewDialogConnector } from "@/presentation/features/mail-workspace/connectors/attachment-preview-dialog.connector";
import { ReceivedAttachmentListConnector } from "@/presentation/features/mail-workspace/connectors/received-attachment-list.connector";
import { MessageReaderToolbarView } from "@/presentation/features/mail-workspace/ui/message-reader-toolbar.view";
import { MessageConversationView } from "@/presentation/features/mail-workspace/ui/message-conversation.view";
import { MessageBodyConnector } from "@/presentation/features/mail-workspace/connectors/message-body.connector";
import { MessageDetailsView } from "@/presentation/features/mail-workspace/ui/message-details.view";
import { CalendarInvitationConnector } from "@/presentation/features/mail-workspace/connectors/calendar-invitation.connector";
import type { MailSnoozeViewModel } from "@/presentation/features/mail-workspace/mail-snooze.view-model";

interface MessageReaderViewProps {
  readonly activeRole: MailboxRole | null;
  readonly canPermanentlyDelete: boolean;
  readonly isComposerReady: boolean;
  readonly keyboardShortcutsEnabled?: boolean;
  readonly isMutating: boolean;
  readonly onArchive: () => void;
  readonly onClose: () => void;
  readonly onDelete: () => void;
  readonly onForward: () => void;
  readonly onReply: () => void;
  readonly onReplyAll: () => void;
  readonly onRequestDestroy: () => void;
  readonly onRequestMove: React.MouseEventHandler<HTMLButtonElement>;
  readonly onRestore: () => void;
  readonly onToggleRead: () => void;
  readonly onToggleStar: () => void;
  readonly reader: ReaderViewModel;
  readonly snooze?: MailSnoozeViewModel;
}

export const MessageReaderView = ({
  activeRole,
  canPermanentlyDelete,
  isComposerReady,
  keyboardShortcutsEnabled = false,
  isMutating,
  onArchive,
  onClose,
  onDelete,
  onForward,
  onReply,
  onReplyAll,
  onRequestDestroy,
  onRequestMove,
  onRestore,
  onToggleRead,
  onToggleStar,
  reader,
  snooze,
}: MessageReaderViewProps) => (
  <section className="flex min-h-0 flex-col bg-white" id="message-reader-region">
    <MessageReaderToolbarView
      activeRole={activeRole}
      canPermanentlyDelete={canPermanentlyDelete}
      isBusy={isMutating}
      keyboardShortcutsEnabled={keyboardShortcutsEnabled}
      onArchive={onArchive}
      onClose={onClose}
      onDelete={onDelete}
      onRequestMove={onRequestMove}
      onRequestDestroy={onRequestDestroy}
      onRestore={onRestore}
      onToggleRead={onToggleRead}
      onToggleStar={onToggleStar}
      reader={reader}
      {...(snooze ? { snooze } : {})}
    />

    <article
      aria-busy={reader.isLoading}
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
          <MessageConversationView conversation={reader.conversation} />
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-700">
            <ShieldCheck aria-hidden size={14} />
            Sanitized message body
          </p>
          <h2
            className="mt-2 text-2xl font-extrabold leading-tight tracking-[-0.04em] text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 md:text-[30px]"
            data-reader-heading
            tabIndex={-1}
          >
            {reader.subject}
          </h2>
          {reader.labels.length ? (
            <div aria-label="Message labels" className="mt-3 flex flex-wrap gap-2">
              {reader.labels.map((label) => (
                <span
                  className="rounded-full border px-2.5 py-1 text-xs font-bold"
                  key={label.id}
                  style={{ borderColor: label.color, color: label.color }}
                >
                  {label.name}
                </span>
              ))}
            </div>
          ) : null}
          <div className="mt-6 flex items-center gap-3 border-b border-slate-100 pb-6">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[#edeaff] text-sm font-extrabold text-[#4f46a5]">
              {reader.avatar}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-extrabold text-slate-800">
                {reader.from}
                <span className="ml-2 font-normal text-slate-600">
                  &lt;{reader.fromEmail}&gt;
                </span>
              </p>
              <p className="mt-0.5 text-xs text-slate-600">to {reader.to}</p>
              {reader.cc ? (
                <p className="mt-0.5 truncate text-xs text-slate-600">
                  cc {reader.cc}
                </p>
              ) : null}
              <MessageDetailsView details={reader.details} />
            </div>
            <time className="hidden text-xs font-medium text-slate-600 sm:block">
              {reader.date}
            </time>
          </div>

          <MessageBodyConnector
            body={reader.body}
            handleSessionFailure={reader.handleSessionFailure}
            htmlBody={reader.htmlBody}
            key={`${reader.messageId}:${reader.sessionScope}`}
            messageId={reader.messageId}
            sessionScope={reader.sessionScope}
          />

          <CalendarInvitationConnector
            handleSessionFailure={reader.handleSessionFailure}
            key={reader.messageId}
            messageId={reader.messageId}
            sessionScope={reader.sessionScope}
          />

          <ReceivedAttachmentListConnector
            attachments={reader.attachments}
            downloadAll={reader.downloadAll}
          />
          <AttachmentPreviewDialogConnector {...reader.attachmentPreview} />

          <div
            aria-label="Actions for this message"
            className="mt-8 flex flex-wrap gap-2"
            role="group"
          >
            <button
              aria-busy={!isComposerReady}
              aria-keyshortcuts={keyboardShortcutsEnabled ? "R" : undefined}
              className="flex h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 disabled:cursor-wait disabled:opacity-70"
              disabled={!isComposerReady}
              onClick={onReply}
              title={isComposerReady ? undefined : "Loading account settings"}
              type="button"
            >
              <Reply aria-hidden size={17} />
              Reply
            </button>
            <button
              aria-busy={!isComposerReady}
              aria-keyshortcuts={keyboardShortcutsEnabled ? "A" : undefined}
              className="flex h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 disabled:cursor-wait disabled:opacity-70"
              disabled={!isComposerReady}
              onClick={onReplyAll}
              title={isComposerReady ? undefined : "Loading account settings"}
              type="button"
            >
              <ReplyAll aria-hidden size={17} />
              Reply all
            </button>
            <button
              aria-busy={!isComposerReady}
              aria-keyshortcuts={keyboardShortcutsEnabled ? "F" : undefined}
              className="flex h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 disabled:cursor-wait disabled:opacity-70"
              disabled={!isComposerReady}
              onClick={onForward}
              title={isComposerReady ? undefined : "Loading account settings"}
              type="button"
            >
              <Forward aria-hidden size={17} />
              Forward
            </button>
          </div>
        </div>
      ) : null}
    </article>
  </section>
);
