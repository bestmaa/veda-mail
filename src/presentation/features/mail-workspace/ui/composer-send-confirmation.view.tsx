import type { ComposerConfirmationViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";

export const ComposerSendConfirmationView = ({
  confirmation,
}: {
  readonly confirmation: ComposerConfirmationViewModel;
}) => confirmation.isOpen ? (
  <div
    aria-labelledby="composer-send-confirmation-title"
    aria-modal="true"
    className="absolute inset-0 z-30 grid place-items-center bg-slate-950/50 p-4"
    id="composer-send-confirmation"
    role="dialog"
    tabIndex={-1}
  >
    <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
      <h2 className="text-base font-bold text-slate-950" id="composer-send-confirmation-title">
        Send this message?
      </h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        Check the recipients, subject, and attachments before continuing.
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button
          className="h-11 rounded-xl px-4 text-sm font-semibold text-slate-600 hover:bg-slate-100"
          data-primary-focus="true"
          onClick={confirmation.onCancel}
          type="button"
        >
          Keep editing
        </button>
        <button
          className="h-11 rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white hover:bg-indigo-700"
          onClick={confirmation.onConfirm}
          type="button"
        >
          Send
        </button>
      </div>
    </div>
  </div>
) : null;
