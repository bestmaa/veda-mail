import { ArrowRight, KeyRound, ServerCog } from "lucide-react";

import type { SetupWizardViewProps } from "@/presentation/features/setup/setup-wizard.view-model";

export const SetupWelcomeView = ({
  model,
}: {
  readonly model: SetupWizardViewProps;
}) => (
  <>
    <span className="grid size-12 place-items-center rounded-2xl bg-indigo-50 text-[var(--brand-primary)]">
      <ServerCog aria-hidden size={23} />
    </span>
    <h2 className="mt-5 text-3xl font-extrabold tracking-[-0.05em]">
      Welcome to your workspace
    </h2>
    <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
      This guided setup creates the first administrator, applies your
      organization brand, and connects the shared mail service.
    </p>
    {model.setupTokenConfigured ? <label className="mt-7 block">
      <span className="mb-2 block text-xs font-bold text-slate-700">
        One-time setup token
      </span>
      <span className="flex h-12 items-center gap-3 rounded-2xl border border-slate-200 px-4 focus-within:border-indigo-400 focus-within:ring-4 focus-within:ring-indigo-100">
        <KeyRound aria-hidden className="text-slate-400" size={18} />
        <input
          autoComplete="one-time-code"
          autoFocus
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          onChange={model.setupTokenInput}
          placeholder="Token from your server environment"
          required
          type="password"
          value={model.setupToken}
        />
      </span>
    </label> : (
      <p className="mt-7 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-800">
        Configure <code>VEDA_MAIL_SETUP_TOKEN</code> in the server environment,
        then restart the application to unlock setup.
      </p>
    )}
    <p className="mt-2 text-xs leading-5 text-slate-400">
      Use the VEDA_MAIL_SETUP_TOKEN configured in your server environment. It
      prevents visitors from claiming a fresh installation.
    </p>
    <button
      className="mt-7 flex h-12 items-center justify-center gap-2 rounded-2xl bg-[var(--brand-primary)] px-5 text-sm font-bold text-white"
      disabled={!model.setupTokenConfigured}
      onClick={model.onNext}
      type="button"
    >
      Start setup <ArrowRight aria-hidden size={17} />
    </button>
  </>
);
