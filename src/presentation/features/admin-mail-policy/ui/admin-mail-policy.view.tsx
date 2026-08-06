import { FileLock2, LoaderCircle, Save } from "lucide-react";

import type { AdminMailPolicyViewProps } from "@/presentation/features/admin-mail-policy/admin-mail-policy.view-model";

export const AdminMailPolicyView = (model: AdminMailPolicyViewProps) => (
  <section>
    <p className="text-[11px] font-extrabold uppercase tracking-[0.17em] text-[var(--brand-primary)]">Outbound safeguards</p>
    <h2 className="mt-1 text-3xl font-extrabold tracking-[-0.05em]">Message &amp; attachment policy</h2>
    <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
      Limits and file rules apply to uploads, forwarded originals, saved drafts,
      and final delivery. Detected MIME type is used instead of trusting headers.
    </p>
    {model.isLoading ? (
      <div className="mt-8 grid min-h-48 place-items-center rounded-[26px] border border-slate-200 bg-white">
        <LoaderCircle aria-label="Loading mail policy" className="animate-spin text-indigo-500" size={26} />
      </div>
    ) : (
      <form className="mt-8 rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6" onSubmit={model.onSubmit}>
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-700"><FileLock2 aria-hidden size={19} /></span>
          <div><h3 className="font-extrabold text-slate-900">Organization mail policy</h3><p className="mt-1 text-xs leading-5 text-slate-500">Changes apply to every mailbox and are rechecked at delivery time.</p></div>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {model.fields.map((field) => (
            <label className="block rounded-2xl border border-slate-200 p-4" key={field.id}>
              <span className="block text-sm font-bold text-slate-800">{field.label}</span>
              <span className="mt-1 block text-xs leading-5 text-slate-500">{field.description}</span>
              <input className="mt-3 h-10 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" min={field.min} onChange={field.onChange} type={field.type} value={field.value} />
            </label>
          ))}
        </div>
        {model.error ? <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700" role="alert">{model.error}</p> : null}
        {model.success ? <p className="mt-4 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700" role="status">{model.success}</p> : null}
        <button className="mt-5 flex h-11 items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 text-sm font-bold text-white disabled:opacity-60" disabled={model.isSaving} type="submit">
          {model.isSaving ? <LoaderCircle aria-hidden className="animate-spin" size={16} /> : <Save aria-hidden size={16} />}
          {model.isSaving ? "Saving…" : "Save mail policy"}
        </button>
      </form>
    )}
  </section>
);
