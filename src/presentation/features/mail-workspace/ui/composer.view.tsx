import { X } from "lucide-react";

import type { ComposerViewModel, DeliveryNoticeViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";
import { EMPTY_RECIPIENT_SUGGESTIONS, type RecipientSuggestionsModel } from "@/presentation/features/mail-workspace/recipient-suggestions.view-model";
import { ComposerAttachmentListView } from "@/presentation/features/mail-workspace/ui/composer-attachment-list.view";
import { ComposerBodyView } from "@/presentation/features/mail-workspace/ui/composer-body.view";
import { ComposerDraftConfirmationsView } from "@/presentation/features/mail-workspace/ui/composer-draft-confirmations.view";
import { ComposerFooterView } from "@/presentation/features/mail-workspace/ui/composer-footer.view";
import { PartialDeliveryNoticeView } from "@/presentation/features/mail-workspace/ui/partial-delivery-notice.view";
import { ComposerTemplateDialogsView } from "@/presentation/features/mail-workspace/ui/composer-template-dialogs.view";
import { ComposerScheduleDialogView } from "@/presentation/features/mail-workspace/ui/composer-schedule-dialog.view";
import { ComposerSendConfirmationView } from "@/presentation/features/mail-workspace/ui/composer-send-confirmation.view";
import { ComposerRecipientFieldView } from "@/presentation/features/mail-workspace/ui/composer-recipient-field.view";

export const ComposerView = ({
  composer,
  deliveryNotice,
  recipients = EMPTY_RECIPIENT_SUGGESTIONS,
}: {
  readonly composer: ComposerViewModel;
  readonly deliveryNotice: DeliveryNoticeViewModel | null;
  readonly recipients?: RecipientSuggestionsModel;
}) => {
  if (!composer.isOpen) return null;
  const confirmationOpen =
    composer.closeConfirmation.isOpen || composer.discardConfirmation.isOpen ||
    composer.body.templates.dialog !== null || composer.schedule.isOpen ||
    composer.sendConfirmation.isOpen;
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
            <ComposerRecipientFieldView autoFocus={!composer.focusBody}
              bccExpanded={composer.showBcc} ccExpanded={composer.showCc}
              disabled={composer.isBusy} id="composer-to" label="To"
              onChange={composer.toInput} placeholder="name@example.com, another@example.com"
              onToggleBcc={composer.onToggleBcc} onToggleCc={composer.onToggleCc}
              readOnly={editorReadOnly} showRecipientControls suggestions={recipients.to}
              value={composer.to} />
            <div hidden={!composer.showCc} id="composer-cc-row"><ComposerRecipientFieldView
              disabled={composer.isBusy} id="composer-cc" label="Cc"
              onChange={composer.ccInput} placeholder="copy@example.com" readOnly={editorReadOnly}
              suggestions={recipients.cc} value={composer.cc} /></div>
            <div hidden={!composer.showBcc} id="composer-bcc-row"><ComposerRecipientFieldView
              disabled={composer.isBusy} id="composer-bcc" label="Bcc"
              onChange={composer.bccInput} placeholder="hidden-copy@example.com" readOnly={editorReadOnly}
              suggestions={recipients.bcc} value={composer.bcc} /></div>
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
        <ComposerSendConfirmationView confirmation={composer.sendConfirmation} />
        <ComposerDraftConfirmationsView composer={composer} />
      </section>
    </>
  );
};
