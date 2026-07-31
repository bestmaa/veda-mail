import type { ComposerViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";

const Confirmation = ({
  cancelLabel,
  confirmId,
  confirmLabel,
  description,
  disabled,
  error,
  onCancel,
  onConfirm,
  title,
}: {
  readonly cancelLabel: string;
  readonly confirmId: string;
  readonly confirmLabel: string;
  readonly description: string;
  readonly disabled: boolean;
  readonly error: string | null;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly title: string;
}) => (
  <div className="absolute inset-0 z-20 grid place-items-center bg-slate-950/35 p-5">
    <div aria-describedby={`${confirmId}-description`} aria-labelledby={`${confirmId}-title`} className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl" role="alertdialog">
      <h2 className="text-base font-bold text-slate-900" id={`${confirmId}-title`}>{title}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600" id={`${confirmId}-description`}>{description}</p>
      {error ? <p className="mt-2 text-sm font-semibold text-red-700" role="alert">{error}</p> : null}
      <div className="mt-5 flex justify-end gap-2">
        <button className="h-10 rounded-xl px-3 text-sm font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50" disabled={disabled} onClick={onCancel} type="button">
          {cancelLabel}
        </button>
        <button className="h-10 rounded-xl bg-red-700 px-3 text-sm font-bold text-white hover:bg-red-800 disabled:opacity-50" disabled={disabled} id={confirmId} onClick={onConfirm} type="button">
          {confirmLabel}
        </button>
      </div>
    </div>
  </div>
);

export const ComposerDraftConfirmationsView = ({
  composer,
}: {
  readonly composer: ComposerViewModel;
}) => composer.discardConfirmation.isOpen ? (
  <Confirmation
    cancelLabel="Keep draft"
    confirmId="composer-discard-confirm"
    confirmLabel="Discard draft permanently"
    description="Any saved provider draft will be permanently deleted. Unsaved changes and local attachments will be cleared."
    disabled={composer.isBusy}
    error={composer.draft.error}
    onCancel={composer.discardConfirmation.onCancel}
    onConfirm={composer.discardConfirmation.onConfirm}
    title="Discard this draft?"
  />
) : composer.closeConfirmation.isOpen ? (
  <Confirmation
    cancelLabel="Keep editing"
    confirmId="composer-close-without-saving"
    confirmLabel="Close without saving"
    description="Unsaved changes will be lost. Your last manually saved provider draft will be kept."
    disabled={composer.isBusy}
    error={null}
    onCancel={composer.closeConfirmation.onCancel}
    onConfirm={composer.closeConfirmation.onConfirm}
    title="Close with unsaved changes?"
  />
) : null;
