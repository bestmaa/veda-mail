import { CheckCircle2, LoaderCircle, Save, ShieldX, XCircle } from "lucide-react";

import type { AdminCapabilitiesViewProps } from "@/presentation/features/admin-capabilities/admin-capabilities.view-model";

const StateIcon = ({ available }: { readonly available: boolean }) =>
  available ? (
    <CheckCircle2 aria-hidden className="text-emerald-600" size={16} />
  ) : (
    <XCircle aria-hidden className="text-slate-400" size={16} />
  );

export const AdminCapabilitiesView = (model: AdminCapabilitiesViewProps) => (
  <section>
    <p className="text-[11px] font-extrabold uppercase tracking-[0.17em] text-[var(--brand-primary)]">
      Provider-aware controls
    </p>
    <h2 className="mt-1 text-3xl font-extrabold tracking-[-0.05em]">
      Capabilities &amp; policy
    </h2>
    <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
      Provider support is immutable here. Organization policy can only narrow
      supported features and is enforced again by member APIs.
    </p>
    {model.isLoading ? (
      <div className="mt-8 grid min-h-64 place-items-center rounded-[26px] border border-slate-200 bg-white">
        <LoaderCircle aria-label="Loading capabilities" className="animate-spin text-indigo-500" size={26} />
      </div>
    ) : (
      <div className="mt-8 grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
        <section className="overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4 sm:px-6">
            <h3 className="font-extrabold text-slate-900">Capability matrix</h3>
            <p className="mt-1 text-xs text-slate-500">
              Declared by {model.providerName}; effective access also reflects organization policy.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-bold">Feature</th>
                  <th className="px-4 py-3 font-bold">Provider</th>
                  <th className="px-4 py-3 font-bold">Organization</th>
                  <th className="px-5 py-3 font-bold">Effective</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {model.capabilities.map((capability) => (
                  <tr key={capability.id}>
                    <th className="px-5 py-3 font-semibold text-slate-800">{capability.label}</th>
                    <td className="px-4 py-3 text-slate-600">{capability.providerLabel}</td>
                    <td className="px-4 py-3 text-slate-600">{capability.organizationLabel}</td>
                    <td className="px-5 py-3">
                      <span className="inline-flex items-center gap-1.5 font-bold text-slate-700">
                        <StateIcon available={capability.effective} />
                        {capability.effectiveLabel}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <form className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6" onSubmit={model.onSubmit}>
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-700">
              <ShieldX aria-hidden size={19} />
            </span>
            <div>
              <h3 className="font-extrabold text-slate-900">Member self-service policy</h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Changes apply to every mailbox in this installation.
              </p>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            {model.policyControls.map((control) => (
              <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 p-4" key={control.id}>
                <input checked={control.checked} className="mt-0.5 size-4 accent-indigo-600" onChange={control.onChange} type="checkbox" />
                <span>
                  <span className="block text-sm font-bold text-slate-800">{control.label}</span>
                  <span className="mt-1 block text-xs leading-5 text-slate-500">{control.description}</span>
                </span>
              </label>
            ))}
          </div>
          {model.error ? <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700" role="alert">{model.error}</p> : null}
          {model.success ? <p className="mt-4 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700" role="status">{model.success}</p> : null}
          <button className="mt-5 flex h-11 items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 text-sm font-bold text-white disabled:opacity-60" disabled={model.isSaving} type="submit">
            {model.isSaving ? <LoaderCircle aria-hidden className="animate-spin" size={16} /> : <Save aria-hidden size={16} />}
            {model.isSaving ? "Saving…" : "Save policy"}
          </button>
        </form>
      </div>
    )}
  </section>
);
