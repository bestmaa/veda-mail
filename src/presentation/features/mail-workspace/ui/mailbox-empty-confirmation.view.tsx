import type { MailboxLifecycleViewModel } from "@/presentation/features/mail-workspace/mailbox-lifecycle.view-model";

export const MailboxEmptyConfirmationView = ({
  lifecycle,
}: {
  readonly lifecycle: MailboxLifecycleViewModel;
}) => lifecycle.confirmation.isOpen ? (
  <div className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/55 p-4">
    <div
      aria-describedby="mailbox-empty-confirmation-description"
      aria-labelledby="mailbox-empty-confirmation-title"
      aria-modal="true"
      className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"
      id="mailbox-empty-confirmation-dialog"
      role="alertdialog"
      tabIndex={-1}
    >
      <h2 className="text-xl font-extrabold text-slate-900" id="mailbox-empty-confirmation-title">
        {lifecycle.confirmation.title}
      </h2>
      <p className="mt-2 text-sm leading-6 text-slate-600" id="mailbox-empty-confirmation-description">
        {lifecycle.confirmation.description}
      </p>
      <div className="mt-6 flex justify-end gap-3">
        <button
          className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          id="mailbox-empty-confirmation-cancel"
          onClick={lifecycle.confirmation.onCancel}
          type="button"
        >
          Cancel
        </button>
        <button
          className="min-h-11 rounded-xl bg-red-700 px-4 text-sm font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
          id="mailbox-empty-confirmation-confirm"
          onClick={lifecycle.confirmation.onConfirm}
          type="button"
        >
          {lifecycle.emptyLabel} permanently
        </button>
      </div>
    </div>
  </div>
) : null;
