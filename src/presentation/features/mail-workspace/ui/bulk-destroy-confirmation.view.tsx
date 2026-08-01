import type { BulkActionsViewModel } from "@/presentation/features/mail-workspace/bulk-actions.view-model";

export const BulkDestroyConfirmationView = ({
  bulk,
}: {
  readonly bulk: BulkActionsViewModel;
}) => bulk.destroyConfirmation.isOpen ? (
  <div className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/55 p-4">
    <div
      aria-describedby="bulk-destroy-confirmation-description"
      aria-labelledby="bulk-destroy-confirmation-title"
      aria-modal="true"
      className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"
      id="bulk-destroy-confirmation-dialog"
      role="alertdialog"
      tabIndex={-1}
    >
      <h2
        className="text-xl font-extrabold text-slate-900"
        id="bulk-destroy-confirmation-title"
      >
        Permanently delete {bulk.destroyConfirmation.count}{" "}
        {bulk.destroyConfirmation.count === 1 ? "message" : "messages"}?
      </h2>
      <p
        className="mt-2 text-sm leading-6 text-slate-600"
        id="bulk-destroy-confirmation-description"
      >
        This cannot be undone. The selected messages will be removed from the
        mail provider instead of moved to another folder.
      </p>
      <div className="mt-6 flex justify-end gap-3">
        <button
          className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          id="bulk-destroy-confirmation-cancel"
          onClick={bulk.destroyConfirmation.onCancel}
          type="button"
        >
          Cancel
        </button>
        <button
          className="min-h-11 rounded-xl bg-red-700 px-4 text-sm font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
          id="bulk-destroy-confirmation-confirm"
          onClick={bulk.destroyConfirmation.onConfirm}
          type="button"
        >
          Permanently delete
        </button>
      </div>
    </div>
  </div>
) : null;
