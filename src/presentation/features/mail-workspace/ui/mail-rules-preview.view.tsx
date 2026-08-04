import { FlaskConical } from "lucide-react";

import type { MailRulesViewModel } from "@/presentation/features/mail-workspace/mail-rules.view-model";

export const MailRulesPreviewView = ({ rules }: { readonly rules: MailRulesViewModel }) => {
  const { preview } = rules;
  return (
    <section aria-labelledby="mail-rules-preview-title" className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h4 className="text-sm font-bold text-slate-900" id="mail-rules-preview-title">Dry run</h4><p className="text-xs text-slate-500">Test saved rules against up to 25 recent messages. Nothing is changed.</p></div>
        <button className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-indigo-200 bg-white px-3 text-xs font-bold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50" disabled={preview.isLoading || rules.isBusy || !rules.rules.length} onClick={preview.onRun} type="button">
          <FlaskConical aria-hidden size={14} />{preview.isLoading ? "Testing..." : "Run dry test"}
        </button>
      </div>
      {preview.error ? <p className="rounded-lg bg-rose-50 p-2 text-xs font-medium text-rose-700" role="alert">{preview.error}</p> : null}
      {preview.isLoading ? <p className="text-xs text-slate-500" role="status">Checking recent messages...</p> : null}
      {preview.hasRun && !preview.isLoading && !preview.error && !preview.items.length ? <p className="text-xs text-slate-500" role="status">No recent messages were available for this dry run.</p> : null}
      {preview.items.length ? <ol className="max-h-72 space-y-2 overflow-y-auto" aria-label="Dry run results">
        {preview.items.map((item) => <li className="rounded-lg border border-slate-200 bg-white p-3" key={item.messageId}>
          <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-xs font-bold text-slate-900">{item.subject}</p><p className="truncate text-[11px] text-slate-500">From {item.from}</p></div><time className="text-[10px] text-slate-500" dateTime={item.receivedAt}>{new Date(item.receivedAt).toLocaleString()}</time></div>
          <dl className="mt-2 grid gap-1 text-[11px] sm:grid-cols-2"><div><dt className="font-bold text-slate-500">Matched rules</dt><dd className="text-slate-700">{item.matchedRules}</dd></div><div><dt className="font-bold text-slate-500">Planned actions</dt><dd className="text-slate-700">{item.actions}</dd></div></dl>
        </li>)}
      </ol> : null}
    </section>
  );
};
