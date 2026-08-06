import { FileClock, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";

import type { AdminSecurityAuditViewProps } from "@/presentation/features/admin-security-audit/admin-security-audit.view-model";

export const AdminSecurityAuditView = (model: AdminSecurityAuditViewProps) => (
  <section aria-labelledby="security-audit-title">
    <p className="text-[11px] font-extrabold uppercase tracking-[0.17em] text-[#b7331b]">Security evidence</p>
    <h2 className="mt-1 text-3xl font-extrabold tracking-[-0.05em] sm:text-4xl" id="security-audit-title">Audit log</h2>
    <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Tamper-evident, privacy-bounded records for authentication, administrator changes, exports, rules, and destructive mail actions.</p>
    {model.error ? <p className="mt-5 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700" role="alert">{model.error}</p> : null}
    <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-800">
      <ShieldCheck aria-hidden size={17} />
      {model.verifiedAt ? `Integrity verified ${new Date(model.verifiedAt).toLocaleString()}` : "Integrity verification pending"}
      {model.droppedCount > 0 ? <span>· {model.droppedCount.toLocaleString()} oldest records expired by retention.</span> : null}
    </div>
    {model.isLoading ? (
      <div aria-label="Loading audit log" className="mt-6 grid min-h-64 place-items-center rounded-[26px] border border-slate-200 bg-white"><LoaderCircle aria-hidden className="animate-spin text-indigo-500" size={27} /></div>
    ) : model.items.length === 0 ? (
      <div className="mt-6 rounded-[26px] border border-slate-200 bg-white p-10 text-center shadow-sm">
        <FileClock aria-hidden className="mx-auto text-indigo-600" size={27} />
        <h3 className="mt-3 font-extrabold">No security events yet</h3>
        <p className="mt-1 text-sm text-slate-500">New protected actions will appear here.</p>
      </div>
    ) : (
      <div className="mt-6 overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-sm">
        <ul className="divide-y divide-slate-100">
          {model.items.map((entry) => (
            <li className="grid gap-2 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto]" key={entry.id}>
              <div>
                <p className="text-sm font-extrabold text-slate-900">{entry.action}</p>
                <p className="mt-1 break-all text-xs text-slate-500">{entry.actor}{entry.target ? ` → ${entry.target}` : ""}{entry.count ? ` · ${entry.count} affected` : ""}</p>
                {entry.requestId ? <p className="mt-1 break-all font-mono text-[10px] text-slate-500">Request {entry.requestId}</p> : null}
              </div>
              <div className="sm:text-right">
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide text-slate-700">{entry.outcome}</span>
                <p className="mt-2 text-xs text-slate-500">{entry.timestamp}</p>
              </div>
            </li>
          ))}
        </ul>
        {model.nextCursor ? <div className="border-t border-slate-100 p-4 text-center"><button className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-4 text-xs font-bold hover:bg-slate-50 disabled:opacity-60" disabled={model.isLoadingMore} onClick={model.onLoadMore} type="button">{model.isLoadingMore ? <LoaderCircle aria-hidden className="animate-spin" size={15} /> : null}Load older events</button></div> : null}
      </div>
    )}
    {model.error && !model.isLoading ? <button className="mt-4 inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold" onClick={model.onRetry} type="button"><RefreshCw aria-hidden size={14} />Retry</button> : null}
  </section>
);
