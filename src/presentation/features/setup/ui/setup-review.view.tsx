import { Check, LoaderCircle, Rocket } from "lucide-react";

import type { SetupWizardViewProps } from "@/presentation/features/setup/setup-wizard.view-model";

export const SetupReviewView = ({
  model,
}: {
  readonly model: SetupWizardViewProps;
}) => (
  <form onSubmit={model.onSubmit}>
    <p className="text-xs font-extrabold uppercase tracking-[0.17em] text-[var(--brand-accent)]">
      Review
    </p>
    <h2 className="mt-2 text-3xl font-extrabold tracking-[-0.05em]">
      Ready to launch
    </h2>
    <p className="mt-2 text-sm leading-6 text-slate-500">
      Confirm the installation summary. You can change organization, provider,
      and security settings later from administration.
    </p>
    <dl className="mt-7 divide-y divide-slate-100 rounded-2xl border border-slate-200">
      <div className="grid gap-1 p-4 sm:grid-cols-[170px_1fr]">
        <dt className="text-xs font-bold text-slate-400">Administrator</dt>
        <dd className="text-sm font-semibold">{model.adminUsername}</dd>
      </div>
      <div className="grid gap-1 p-4 sm:grid-cols-[170px_1fr]">
        <dt className="text-xs font-bold text-slate-400">Organization</dt>
        <dd className="text-sm font-semibold">{model.organizationName} · {model.productName}</dd>
      </div>
      <div className="grid gap-1 p-4 sm:grid-cols-[170px_1fr]">
        <dt className="text-xs font-bold text-slate-400">Mail service</dt>
        <dd className="text-sm font-semibold">{model.providerDisplayName}</dd>
      </div>
      <div className="grid gap-1 p-4 sm:grid-cols-[170px_1fr]">
        <dt className="text-xs font-bold text-slate-400">Allowed domains</dt>
        <dd className="whitespace-pre-line text-sm font-semibold">{model.allowedDomains}</dd>
      </div>
    </dl>
    <button
      className="mt-7 flex h-12 items-center justify-center gap-2 rounded-2xl bg-[var(--brand-primary)] px-5 text-sm font-bold text-white disabled:opacity-60"
      disabled={model.isSubmitting}
      type="submit"
    >
      {model.isSubmitting ? <LoaderCircle aria-hidden className="animate-spin" size={17} /> : <Rocket aria-hidden size={17} />}
      {model.isSubmitting ? "Creating workspace…" : "Finish setup"}
    </button>
    <p className="mt-4 flex items-center gap-2 text-xs font-semibold text-emerald-700">
      <Check aria-hidden size={15} /> Setup access locks automatically after completion.
    </p>
  </form>
);
