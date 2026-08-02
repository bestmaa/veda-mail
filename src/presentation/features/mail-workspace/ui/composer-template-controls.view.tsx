import { RefreshCw } from "lucide-react";

import type { ComposerTemplateViewModel } from "@/presentation/features/mail-workspace/composer-template.view-model";

export const ComposerTemplateControlsView = ({
  disabled,
  templates,
}: {
  readonly disabled: boolean;
  readonly templates: ComposerTemplateViewModel;
}) => {
  const selected = Boolean(templates.selectedId);
  const unavailable = disabled || !templates.canManage;
  return (
    <div className="border-b border-slate-100 bg-slate-50/70 px-3 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <label className="text-xs font-bold text-slate-600" htmlFor="composer-template-select">
          Email template
        </label>
        <select
          className="h-9 min-w-32 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-800 outline-none focus-visible:outline-2 focus-visible:outline-indigo-600 disabled:text-slate-400"
          disabled={unavailable || templates.isLoading || templates.options.length === 0}
          id="composer-template-select"
          onChange={templates.onSelect}
          value={templates.selectedId}
        >
          {templates.options.length === 0 ? <option value="">No saved templates</option> : null}
          {templates.options.map((option) => (
            <option key={option.id} value={option.id}>{option.name}</option>
          ))}
        </select>
        <button className="h-9 rounded-lg bg-indigo-700 px-3 text-xs font-bold text-white disabled:opacity-50" disabled={unavailable || !selected} onClick={templates.onInsert} type="button">
          Insert
        </button>
        <button className="h-9 rounded-lg border border-indigo-200 px-3 text-xs font-bold text-indigo-800 disabled:opacity-50" disabled={unavailable || !selected} onClick={templates.onRequestReplace} type="button">
          Replace
        </button>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        <button className="rounded-lg px-2 py-1 text-[11px] font-bold text-indigo-700 hover:bg-indigo-50 disabled:text-slate-400" disabled={unavailable} onClick={templates.onSaveNew} type="button">Save current as new</button>
        <button className="rounded-lg px-2 py-1 text-[11px] font-bold text-indigo-700 hover:bg-indigo-50 disabled:text-slate-400" disabled={unavailable || !selected} onClick={templates.onUpdate} type="button">Update selected</button>
        <button className="rounded-lg px-2 py-1 text-[11px] font-bold text-red-700 hover:bg-red-50 disabled:text-slate-400" disabled={unavailable || !selected} onClick={templates.onRequestDelete} type="button">Delete selected</button>
        {templates.error ? (
          <span className="basis-full text-xs font-semibold text-red-700" role="alert">
            {templates.error}
            <button className="ml-2 underline" onClick={templates.retry} type="button">
              <RefreshCw aria-hidden className="mr-1 inline" size={12} />Retry
            </button>
          </span>
        ) : null}
      </div>
      <span aria-atomic="true" aria-live="polite" className="sr-only" role="status">
        {templates.isLoading ? "Loading email templates." : templates.announcement}
      </span>
    </div>
  );
};
