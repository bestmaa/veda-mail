import { Paperclip, RefreshCw, Send, Trash2, X } from "lucide-react";

import type { ComposerViewModel, DeliveryNoticeViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";
import { ComposerAttachmentListView } from "@/presentation/features/mail-workspace/ui/composer-attachment-list.view";
import { ComposerBodyView } from "@/presentation/features/mail-workspace/ui/composer-body.view";
import { PartialDeliveryNoticeView } from "@/presentation/features/mail-workspace/ui/partial-delivery-notice.view";

export const ComposerView = ({
  composer,
  deliveryNotice,
}: {
  readonly composer: ComposerViewModel;
  readonly deliveryNotice: DeliveryNoticeViewModel | null;
}) =>
  composer.isOpen ? (
    <>
      <div aria-hidden="true" className="fixed inset-0 z-30 bg-slate-950/10" />
      <section
        aria-label="Compose message"
        aria-modal="true"
        className="fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-[max(0.75rem,env(safe-area-inset-left))] right-[max(0.75rem,env(safe-area-inset-right))] z-40 flex min-w-0 max-h-[calc(100dvh_-_max(0.75rem,env(safe-area-inset-top))_-_max(0.75rem,env(safe-area-inset-bottom)))] flex-col overflow-hidden overscroll-contain rounded-[22px] border border-slate-200 bg-white shadow-2xl shadow-slate-900/20 sm:left-auto sm:right-[max(1.25rem,env(safe-area-inset-right))] sm:w-[560px]"
        role="dialog"
        tabIndex={-1}
      >
        <div className="flex h-13 shrink-0 items-center gap-2 bg-[#292c68] px-4 text-white">
          <p className="flex-1 text-sm font-bold">{composer.title}</p>
          <button
            aria-label="Close composer"
            className="grid size-8 place-items-center rounded-lg text-indigo-100/70 hover:bg-white/10 hover:text-white"
            disabled={composer.isSending}
            onClick={composer.onClose}
            type="button"
          >
            <X aria-hidden size={17} />
          </button>
        </div>

        {deliveryNotice ? (
          <PartialDeliveryNoticeView notice={deliveryNotice} placement="composer" />
        ) : null}
        <form
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-contain"
          onSubmit={composer.onSubmit}
        >
          <div className="flex min-h-12 items-center border-b border-slate-100 px-4">
            <label
              className="w-14 text-xs font-semibold text-slate-600"
              htmlFor="composer-to"
            >
              To
            </label>
            <input
              autoComplete="email"
              autoFocus={!composer.focusBody}
              className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none focus-visible:outline-2 focus-visible:outline-indigo-600"
              disabled={composer.isSending}
              id="composer-to"
              onChange={composer.toInput}
              placeholder="name@example.com, another@example.com"
              type="text"
              value={composer.to}
            />
            <button
              aria-controls="composer-cc-row"
              aria-expanded={composer.showCc}
              className="ml-2 rounded-lg px-2 py-1 text-xs font-bold text-slate-500 hover:bg-indigo-50 hover:text-indigo-700"
              disabled={composer.isSending}
              onClick={composer.onToggleCc}
              type="button"
            >
              Cc
            </button>
            <button
              aria-controls="composer-bcc-row"
              aria-expanded={composer.showBcc}
              className="rounded-lg px-2 py-1 text-xs font-bold text-slate-500 hover:bg-indigo-50 hover:text-indigo-700"
              disabled={composer.isSending}
              onClick={composer.onToggleBcc}
              type="button"
            >
              Bcc
            </button>
          </div>
          <label
            className="flex min-h-12 items-center border-b border-slate-100 px-4"
            hidden={!composer.showCc}
            id="composer-cc-row"
          >
            <span className="w-14 text-xs font-semibold text-slate-600">
              Cc
            </span>
            <input
              autoComplete="email"
              className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none focus-visible:outline-2 focus-visible:outline-indigo-600"
              disabled={composer.isSending}
              id="composer-cc"
              onChange={composer.ccInput}
              placeholder="copy@example.com"
              type="text"
              value={composer.cc}
            />
          </label>
          <label
            className="flex min-h-12 items-center border-b border-slate-100 px-4"
            hidden={!composer.showBcc}
            id="composer-bcc-row"
          >
            <span className="w-14 text-xs font-semibold text-slate-600">
              Bcc
            </span>
            <input
              autoComplete="email"
              className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none focus-visible:outline-2 focus-visible:outline-indigo-600"
              disabled={composer.isSending}
              id="composer-bcc"
              onChange={composer.bccInput}
              placeholder="hidden-copy@example.com"
              type="text"
              value={composer.bcc}
            />
          </label>
          <label className="flex min-h-12 items-center border-b border-slate-100 px-4">
            <span className="w-14 text-xs font-semibold text-slate-600">
              Subject
            </span>
            <input
              className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-800 outline-none focus-visible:outline-2 focus-visible:outline-indigo-600"
              disabled={composer.isSending}
              onChange={composer.subjectInput}
              placeholder="What is this about?"
              type="text"
              value={composer.subject}
            />
          </label>
          <ComposerBodyView
            body={composer.body}
            focusBody={composer.focusBody}
            isSending={composer.isSending}
          />
          <ComposerAttachmentListView
            attachments={composer.attachments}
            isSending={composer.isSending}
          />
          {composer.error ? (
            <p
              className="mx-4 mb-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700"
              role="alert"
            >
              {composer.error}
            </p>
          ) : null}
          <div className="flex h-15 shrink-0 items-center gap-1 border-t border-slate-100 px-3">
            <button
              aria-live="polite"
              className="flex h-10 items-center gap-2 rounded-xl bg-[#ff785a] px-4 text-sm font-bold text-slate-950 transition hover:bg-[#ff6848] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={
                composer.isSending ||
                composer.isUploading ||
                composer.attachments.some(
                  (attachment) => attachment.state === "error",
                )
              }
              type="submit"
            >
              <Send aria-hidden size={16} />
              {composer.isSending ? "Sending…" : "Send"}
            </button>
            <label
              aria-label={
                composer.maxAttachmentBytes > 0
                  ? "Attach files"
                  : composer.attachmentCapabilityUnavailable
                    ? "Attachment limit could not be verified"
                    : "Attachments are unavailable for this provider"
              }
              className={`grid size-9 place-items-center rounded-xl focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-indigo-600 ${
                composer.maxAttachmentBytes > 0 && !composer.isSending
                  ? "cursor-pointer text-slate-600 hover:bg-indigo-50 hover:text-indigo-700"
                  : "cursor-not-allowed text-slate-300"
              }`}
              htmlFor="composer-attachments"
              title={
                composer.maxAttachmentBytes > 0
                  ? "Attach files"
                  : composer.attachmentCapabilityUnavailable
                    ? "Attachment limit could not be verified"
                    : "Attachments are unavailable for this provider"
              }
            >
              <Paperclip aria-hidden size={18} />
              <input
                className="sr-only"
                disabled={
                  composer.isSending || composer.maxAttachmentBytes <= 0
                }
                id="composer-attachments"
                multiple
                onChange={composer.attachmentInput}
                type="file"
              />
            </label>
            {composer.attachmentCapabilityUnavailable ? (
              <button
                className="flex h-9 items-center gap-1.5 rounded-xl px-2 text-xs font-bold text-indigo-700 hover:bg-indigo-50 disabled:cursor-wait disabled:text-slate-400"
                disabled={
                  composer.isAttachmentCapabilityRefreshing ||
                  composer.isSending
                }
                onClick={composer.onRetryAttachmentCapability}
                type="button"
              >
                <RefreshCw
                  aria-hidden
                  className={
                    composer.isAttachmentCapabilityRefreshing
                      ? "animate-spin"
                      : undefined
                  }
                  size={14}
                />
                {composer.isAttachmentCapabilityRefreshing
                  ? "Checking…"
                  : "Retry attachment check"}
              </button>
            ) : null}
            <span className="sr-only" role="status">
              {composer.isUploading ? "Preparing and scanning attachments" : ""}
            </span>
            <span className="flex-1" />
            <button
              aria-label="Discard draft"
              className="grid size-9 place-items-center rounded-xl text-slate-600 hover:bg-red-50 hover:text-red-700"
              disabled={composer.isSending}
              onClick={composer.onClose}
              type="button"
            >
              <Trash2 aria-hidden size={17} />
            </button>
          </div>
        </form>
      </section>
    </>
  ) : null;
