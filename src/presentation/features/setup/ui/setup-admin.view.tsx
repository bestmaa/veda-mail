import { ArrowRight, ShieldCheck } from "lucide-react";

import type { SetupWizardViewProps } from "@/presentation/features/setup/setup-wizard.view-model";

export const SetupAdminView = ({
  model,
}: {
  readonly model: SetupWizardViewProps;
}) => (
  <>
    <p className="text-xs font-extrabold uppercase tracking-[0.17em] text-[var(--brand-accent)]">
      Administrator
    </p>
    <h2 className="mt-2 text-3xl font-extrabold tracking-[-0.05em]">
      Create the owner account
    </h2>
    <p className="mt-2 text-sm leading-6 text-slate-500">
      This account manages branding, mail providers, domains, and security.
      Mailbox users cannot access these settings.
    </p>
    <div className="mt-7 space-y-4">
      <label className="block">
        <span className="mb-2 block text-xs font-bold">Admin username</span>
        <input
          autoComplete="username"
          className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
          onChange={model.adminUsernameInput}
          placeholder="owner"
          value={model.adminUsername}
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-2 block text-xs font-bold">Password</span>
          <input
            autoComplete="new-password"
            className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
            onChange={model.adminPasswordInput}
            placeholder="12+ characters"
            type="password"
            value={model.adminPassword}
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-xs font-bold">Confirm password</span>
          <input
            autoComplete="new-password"
            className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
            onChange={model.adminPasswordConfirmationInput}
            placeholder="Repeat password"
            type="password"
            value={model.adminPasswordConfirmation}
          />
        </label>
      </div>
    </div>
    <p className="mt-4 flex items-center gap-2 text-xs font-semibold text-emerald-700">
      <ShieldCheck aria-hidden size={15} />
      The password is stored as a one-way hash.
    </p>
    <button className="mt-7 flex h-12 items-center gap-2 rounded-2xl bg-[var(--brand-primary)] px-5 text-sm font-bold text-white" onClick={model.onNext} type="button">
      Continue <ArrowRight aria-hidden size={17} />
    </button>
  </>
);
