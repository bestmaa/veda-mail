import { X } from "lucide-react";

import type { ComposerViewModel, DeliveryNoticeViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";
import { ComposerAttachmentListView } from "@/presentation/features/mail-workspace/ui/composer-attachment-list.view";
import { ComposerBodyView } from "@/presentation/features/mail-workspace/ui/composer-body.view";
import { ComposerDraftConfirmationsView } from "@/presentation/features/mail-workspace/ui/composer-draft-confirmations.view";
import { ComposerFooterView } from "@/presentation/features/mail-workspace/ui/composer-footer.view";
import { PartialDeliveryNoticeView } from "@/presentation/features/mail-workspace/ui/partial-delivery-notice.view";
import { ComposerTemplateDialogsView } from "@/presentation/features/mail-workspace/ui/composer-template-dialogs.view";
import { ComposerScheduleDialogView } from "@/presentation/features/mail-workspace/ui/composer-schedule-dialog.view";

export const ComposerView = ({
  composer,
  deliveryNotice,
}: {
  readonly composer: ComposerViewModel;
  readonly deliveryNotice: DeliveryNoticeViewModel | null;
}) => {
  if (!composer.isOpen) return null;
  const confirmationOpen =
    composer.closeConfirmation.isOpen || composer.discardConfirmation.isOpen ||
    composer.body.templates.dialog !== null || composer.schedule.isOpen;
  const editorReadOnly = !composer.draft.canEdit;
  return (
    <>
      <div aria-hidden="true" className="fixed inset-0 z-30 bg-slate-950/10" />
      <section
        aria-label="Compose message"
        aria-modal="true"
        className="fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-[max(0.75rem,env(safe-area-inset-left))] right-[max(0.75rem,env(safe-area-inset-right))] z-40 flex min-w-0 max-h-[calc(100dvh_-_max(0.75rem,env(safe-area-inset-top))_-_max(0.75rem,env(safe-area-inset-bottom)))] flex-col overflow-hidden overscroll-contain rounded-[22px] border border-slate-200 bg-white shadow-2xl shadow-slate-900/20 sm:left-auto sm:right-[max(1.25rem,env(safe-area-inset-right))] sm:w-[560px]"
        role="dialog"
        tabIndex={-1}
      >
        <div
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
          {...(confirmationOpen ? { "aria-hidden": true, inert: true } : {})}
        >
          <div className="flex h-13 shrink-0 items-center gap-2 bg-[#292c68] px-4 text-white">
            <p className="flex-1 text-sm font-bold">{composer.title}</p>
            <button
              aria-label="Close composer"
              className="grid size-8 place-items-center rounded-lg text-indigo-100/70 hover:bg-white/10 hover:text-white disabled:opacity-50"
              disabled={composer.isBusy || composer.draft.phase === "saving"}
              id="composer-close"
              onClick={composer.onClose}
              type="button"
            >
              <X aria-hidden size={17} />
            </button>
          </div>
          {deliveryNotice ? <PartialDeliveryNoticeView notice={deliveryNotice} placement="composer" /> : null}
          <form className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-contain" onSubmit={composer.onSubmit}>
            <div className="flex min-h-12 items-center border-b border-slate-100 px-4">
              <label className="w-14 text-xs font-semibold text-slate-600" htmlFor="composer-to">To</label>
              <input
                autoComplete="email"
                autoFocus={!composer.focusBody}
                className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none focus-visible:outline-2 focus-visible:outline-indigo-600"
                disabled={composer.isBusy}
                id="composer-to"
                onChange={composer.toInput}
                placeholder="name@example.com, another@example.com"
                readOnly={editorReadOnly}
                type="text"
                value={composer.to}
              />
              <button aria-controls="composer-cc-row" aria-expanded={composer.showCc} className="ml-2 rounded-lg px-2 py-1 text-xs font-bold text-slate-500 hover:bg-indigo-50 hover:text-indigo-700" disabled={composer.isBusy || editorReadOnly} onClick={composer.onToggleCc} type="button">Cc</button>
              <button aria-controls="composer-bcc-row" aria-expanded={composer.showBcc} className="rounded-lg px-2 py-1 text-xs font-bold text-slate-500 hover:bg-indigo-50 hover:text-indigo-700" disabled={composer.isBusy || editorReadOnly} onClick={composer.onToggleBcc} type="button">Bcc</button>
            </div>
            <label className="flex min-h-12 items-center border-b border-slate-100 px-4" hidden={!composer.showCc} id="composer-cc-row">
              <span className="w-14 text-xs font-semibold text-slate-600">Cc</span>
              <input autoComplete="email" className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none focus-visible:outline-2 focus-visible:outline-indigo-600" disabled={composer.isBusy} id="composer-cc" onChange={composer.ccInput} placeholder="copy@example.com" readOnly={editorReadOnly} type="text" value={composer.cc} />
            </label>
            <label className="flex min-h-12 items-center border-b border-slate-100 px-4" hidden={!composer.showBcc} id="composer-bcc-row">
              <span className="w-14 text-xs font-semibold text-slate-600">Bcc</span>
              <input autoComplete="email" className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none focus-visible:outline-2 focus-visible:outline-indigo-600" disabled={composer.isBusy} id="composer-bcc" onChange={composer.bccInput} placeholder="hidden-copy@example.com" readOnly={editorReadOnly} type="text" value={composer.bcc} />
            </label>
            <label className="flex min-h-12 items-center border-b border-slate-100 px-4">
              <span className="w-14 text-xs font-semibold text-slate-600">Subject</span>
              <input className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-800 outline-none focus-visible:outline-2 focus-visible:outline-indigo-600" disabled={composer.isBusy} onChange={composer.subjectInput} placeholder="What is this about?" readOnly={editorReadOnly} type="text" value={composer.subject} />
            </label>
            <ComposerBodyView body={composer.body} focusBody={composer.focusBody} isReadOnly={editorReadOnly} isSending={composer.isBusy} />
            <ComposerAttachmentListView attachments={composer.attachments} isSending={composer.isBusy || editorReadOnly} />
            <ComposerFooterView composer={composer} />
          </form>
        </div>
        <ComposerTemplateDialogsView templates={composer.body.templates} />
        <ComposerScheduleDialogView schedule={composer.schedule} />
        <ComposerDraftConfirmationsView composer={composer} />
      </section>
    </>
  );
};
