import { ArrowDown, ArrowUp, Filter, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";

import type { MailRule } from "@/domain/mail/rule";
import type { MailRulesViewModel } from "@/presentation/features/mail-workspace/mail-rules.view-model";
import { MailRulesEditorView } from "@/presentation/features/mail-workspace/ui/mail-rules-editor.view";
import { MailRulesPreviewView } from "@/presentation/features/mail-workspace/ui/mail-rules-preview.view";

const ruleSummary = (rule: MailRule): string => {
  const conditions = rule.conditions.length === 1 ? "1 condition" : `${rule.conditions.length} conditions`;
  const actions = rule.actions.map(({ kind }) => kind === "mark-read" ? "mark read" : kind).join(", ");
  return `${rule.match === "all" ? "All" : "Any"} of ${conditions} · ${actions}`;
};

export const MailRulesView = ({ rules }: { readonly rules: MailRulesViewModel }) => {
  const unavailable = rules.capability?.supported === false;
  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start gap-3">
        <Filter aria-hidden className="mt-0.5 text-indigo-600" size={20} />
        <div className="min-w-0 flex-1"><h3 className="font-bold text-slate-900">Mail rules</h3><p className="text-xs text-slate-500">Automatically organize new mail on your provider.</p></div>
        {!unavailable ? <button className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-indigo-600 px-3 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50" disabled={rules.isBusy || rules.isLoading} onClick={rules.onCreate} type="button"><Plus aria-hidden size={15} />New rule</button> : null}
      </div>
      {rules.isLoading ? <p className="text-sm text-slate-500" role="status">Loading mail rules...</p> : null}
      {unavailable ? <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900" role="status"><strong>Rules unavailable.</strong> {rules.capability?.reason}</div> : null}
      {rules.error ? <div className="flex items-center justify-between gap-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700" role="alert"><span>{rules.error}</span><button className="font-bold underline" onClick={rules.onRetry} type="button">Reload</button></div> : null}
      {rules.success ? <p className="rounded-xl bg-emerald-50 p-3 text-sm font-medium text-emerald-700" role="status">{rules.success}</p> : null}
      {!unavailable && rules.deploymentStatus !== "unknown" && rules.deploymentStatus !== "deployed" && rules.rules.length ? <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-900"><span>Provider status: <strong>{rules.deploymentStatus}</strong></span><button className="inline-flex items-center gap-1 font-bold underline disabled:opacity-50" disabled={rules.isBusy} onClick={rules.onReconcile} type="button"><RefreshCw aria-hidden size={13} />Reconcile</button></div> : null}
      <MailRulesEditorView rules={rules} />
      {!unavailable && rules.rules.length ? <MailRulesPreviewView rules={rules} /> : null}
      {!rules.isLoading && !unavailable && !rules.rules.length && !rules.editor.isOpen ? <div className="rounded-xl border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">No rules yet. Create one to organize incoming mail.</div> : null}
      {rules.rules.length ? <ol className="space-y-2" aria-label="Mail rules in processing order">
        {rules.rules.map((rule, index) => <li className="flex items-center gap-3 rounded-xl border border-slate-200 p-3" key={rule.id}>
          <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-lg bg-slate-100 text-xs font-extrabold text-slate-600">{index + 1}</span>
          <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="truncate text-sm font-bold text-slate-900">{rule.name}</span>{!rule.enabled ? <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">Off</span> : null}</div><p className="truncate text-xs text-slate-500">{ruleSummary(rule)}</p></div>
          <label className="flex items-center gap-1 text-xs font-semibold text-slate-600"><input checked={rule.enabled} disabled={rules.isBusy || unavailable} onChange={(event) => rules.onToggle(rule.id, event.target.checked)} type="checkbox" /><span className="sr-only">Enable {rule.name}</span></label>
          <div className="flex">
            <button aria-label={`Move ${rule.name} up`} className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30" disabled={index === 0 || rules.isBusy || unavailable} onClick={() => rules.onMove(rule.id, -1)} type="button"><ArrowUp aria-hidden size={15} /></button>
            <button aria-label={`Move ${rule.name} down`} className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30" disabled={index === rules.rules.length - 1 || rules.isBusy || unavailable} onClick={() => rules.onMove(rule.id, 1)} type="button"><ArrowDown aria-hidden size={15} /></button>
            <button aria-label={`Edit ${rule.name}`} className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30" disabled={rules.isBusy || unavailable} onClick={() => rules.onEdit(rule)} type="button"><Pencil aria-hidden size={15} /></button>
            <button aria-label={`Delete ${rule.name}`} className="grid size-8 place-items-center rounded-lg text-rose-600 hover:bg-rose-50 disabled:opacity-30" disabled={rules.isBusy || unavailable} onClick={() => { if (window.confirm(`Delete rule “${rule.name}”?`)) rules.onDelete(rule.id); }} type="button"><Trash2 aria-hidden size={15} /></button>
          </div>
        </li>)}
      </ol> : null}
    </section>
  );
};
