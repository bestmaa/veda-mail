import type { EmailSignatureConfirmationViewModel } from "@/presentation/features/mail-workspace/email-signature-settings.view-model";

export const EmailSignatureConfirmationView = ({
  confirmation,
  confirmLabel,
  idPrefix,
}: {
  readonly confirmation: EmailSignatureConfirmationViewModel;
  readonly confirmLabel: string;
  readonly idPrefix: string;
}) =>
  confirmation.isOpen ? (
    <div
      aria-describedby={`${idPrefix}-description`}
      aria-labelledby={`${idPrefix}-title`}
      aria-modal="true"
      className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/55 p-4"
      id={idPrefix}
      role="alertdialog"
      tabIndex={-1}
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
        <h4
          className="text-base font-extrabold text-slate-900"
          id={`${idPrefix}-title`}
        >
          {confirmation.title}
        </h4>
        <p
          className="mt-2 text-sm leading-6 text-slate-600"
          id={`${idPrefix}-description`}
        >
          {confirmation.description}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            className="h-10 rounded-xl px-4 text-sm font-bold text-slate-700 hover:bg-slate-100"
            onClick={confirmation.onCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className="h-10 rounded-xl bg-rose-700 px-4 text-sm font-bold text-white hover:bg-rose-800"
            id={`${idPrefix}-confirm`}
            onClick={confirmation.onConfirm}
            type="button"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  ) : null;
