import type { ComposerConfirmationViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";

export const ReaderDestroyConfirmationView = ({
  confirmation,
}: {
  readonly confirmation: ComposerConfirmationViewModel;
}) => confirmation.isOpen ? (
  <div className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/55 p-4">
    <div
      aria-describedby="reader-destroy-confirmation-description"
      aria-labelledby="reader-destroy-confirmation-title"
      aria-modal="true"
      className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"
      id="reader-destroy-confirmation-dialog"
      role="alertdialog"
      tabIndex={-1}
    >
      <h2 className="text-xl font-extrabold" id="reader-destroy-confirmation-title">
        Permanently delete this message?
      </h2>
      <p className="mt-2 text-sm leading-6 text-slate-600" id="reader-destroy-confirmation-description">
        This cannot be undone. The message will be removed from the mail
        provider instead of moved to another folder.
      </p>
      <div className="mt-6 flex justify-end gap-3">
        <button
          className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-bold"
          id="reader-destroy-confirmation-cancel"
          onClick={confirmation.onCancel}
          type="button"
        >
          Cancel
        </button>
        <button
          className="min-h-11 rounded-xl bg-red-700 px-4 text-sm font-bold text-white"
          onClick={confirmation.onConfirm}
          type="button"
        >
          Permanently delete
        </button>
      </div>
    </div>
  </div>
) : null;
