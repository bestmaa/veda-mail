import type { ComposerViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";

export const ComposerRecoveryPromptView = ({
  prompt,
}: {
  readonly prompt: ComposerViewModel["recoveryPrompt"];
}) => prompt.isOpen ? (
  <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-5">
    <section
      aria-describedby="composer-recovery-description"
      aria-labelledby="composer-recovery-title"
      aria-modal="true"
      className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"
      id="composer-recovery-dialog"
      role="alertdialog"
      tabIndex={-1}
    >
      <h2 className="text-base font-bold text-slate-900" id="composer-recovery-title">
        {prompt.title}
      </h2>
      <p className="mt-2 text-sm leading-6 text-slate-600" id="composer-recovery-description">
        {prompt.description}
      </p>
      {prompt.hadLocalAttachments ? (
        <p className="mt-2 text-sm font-semibold text-amber-800" role="status">
          Attached files could not be retained and will need to be added again.
        </p>
      ) : null}
      {prompt.error ? (
        <p className="mt-2 text-sm font-semibold text-red-700" role="alert">
          {prompt.error}
        </p>
      ) : null}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button
          className="h-10 rounded-xl px-3 text-sm font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
          disabled={prompt.isLoading}
          id="composer-recovery-secondary"
          onClick={prompt.onSecondary}
          type="button"
        >
          {prompt.secondaryLabel}
        </button>
        <button
          className="h-10 rounded-xl bg-indigo-700 px-4 text-sm font-bold text-white hover:bg-indigo-800 disabled:opacity-50"
          disabled={prompt.isLoading}
          id="composer-recovery-primary"
          onClick={prompt.onPrimary}
          type="button"
        >
          {prompt.primaryLabel}
        </button>
      </div>
    </section>
  </div>
) : null;
