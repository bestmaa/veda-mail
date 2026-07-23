import { ArrowRight, Server } from "lucide-react";

import type { SetupWizardViewProps } from "@/presentation/features/setup/setup-wizard.view-model";
import { SetupProviderFieldView } from "@/presentation/features/setup/ui/setup-provider-field.view";

export const SetupMailView = ({
  model,
}: {
  readonly model: SetupWizardViewProps;
}) => (
  <>
    <p className="text-xs font-extrabold uppercase tracking-[0.17em] text-[var(--brand-accent)]">
      Mail service
    </p>
    <h2 className="mt-2 text-3xl font-extrabold tracking-[-0.05em]">
      Connect your provider
    </h2>
    <p className="mt-2 text-sm leading-6 text-slate-500">
      This shared connection is controlled by administrators. Members only
      enter their own email address and password.
    </p>
    <div className="mt-6 grid gap-3 sm:grid-cols-2">
      {model.providers.map((provider) => (
        <button
          className={`rounded-2xl border p-4 text-left transition ${
            provider.isSelected
              ? "border-[var(--brand-primary)] bg-indigo-50/60 ring-2 ring-indigo-100"
              : "border-slate-200 hover:border-slate-300"
          }`}
          key={provider.id}
          onClick={provider.onSelect}
          type="button"
        >
          <span className="flex items-center gap-2 text-sm font-extrabold"><Server aria-hidden size={17} />{provider.name}</span>
          <span className="mt-1 block text-[11px] leading-4 text-slate-500">{provider.description}</span>
        </button>
      ))}
    </div>
    <div className="mt-6 grid gap-4 sm:grid-cols-2">
      <label className="block sm:col-span-2">
        <span className="mb-2 block text-xs font-bold">Connection display name</span>
        <input className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100" onChange={model.providerDisplayNameInput} placeholder="Organization mail" value={model.providerDisplayName} />
      </label>
      {model.fields.map((field) => <SetupProviderFieldView field={field} key={field.name} />)}
      <label className="block sm:col-span-2">
        <span className="mb-2 block text-xs font-bold">Allowed email domains</span>
        <textarea className="min-h-24 w-full resize-y rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100" onChange={model.allowedDomainsInput} placeholder={"example.com\nexample.org"} value={model.allowedDomains} />
        <span className="mt-1.5 block text-[11px] text-slate-400">One domain per line, or separate domains with commas.</span>
      </label>
    </div>
    <button className="mt-7 flex h-12 items-center gap-2 rounded-2xl bg-[var(--brand-primary)] px-5 text-sm font-bold text-white" onClick={model.onNext} type="button">
      Review setup <ArrowRight aria-hidden size={17} />
    </button>
  </>
);
