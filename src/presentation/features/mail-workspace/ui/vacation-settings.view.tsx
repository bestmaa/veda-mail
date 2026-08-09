import { CalendarClock } from "lucide-react";

import type { VacationSettingsViewModel } from "@/presentation/features/mail-workspace/vacation-settings.view-model";

const inputClass = "mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 disabled:bg-slate-50";

export const VacationSettingsView = ({ settings }: {
  readonly settings: VacationSettingsViewModel;
}) => (
  <form className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" onSubmit={settings.onSubmit}>
    <div className="mb-4 flex items-center gap-3">
      <CalendarClock aria-hidden className="text-indigo-600" size={20} />
      <div><h3 className="font-bold text-slate-900">Automatic vacation reply</h3>
        <p className="text-xs text-slate-500">Provider-managed out-of-office response</p></div>
    </div>
    {settings.isLoading ? <p className="text-sm text-slate-600" role="status">Loading automatic replies...</p> : null}
    {!settings.isLoading && !settings.isSupported ? (
      <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
        {settings.capabilityReason ?? "Automatic replies are unavailable for this provider."}
      </p>
    ) : null}
    <fieldset className="space-y-3" disabled={!settings.isSupported || settings.isLoading || settings.isSaving}>
      <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
        <input checked={settings.isEnabled} onChange={settings.onEnabledChange} type="checkbox" />
        Send an automatic reply
      </label>
      <label className="block text-xs font-bold text-slate-600">Subject
        <input className={inputClass} maxLength={998} onChange={settings.subjectInput} value={settings.subject} />
      </label>
      <label className="block text-xs font-bold text-slate-600">Message
        <textarea className="mt-1.5 min-h-28 w-full rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 disabled:bg-slate-50" maxLength={32000} onChange={settings.textBodyInput} required={settings.isEnabled} value={settings.textBody} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-bold text-slate-600">Starts (optional)
          <input className={inputClass} onChange={settings.fromDateInput} type="datetime-local" value={settings.fromDate} />
        </label>
        <label className="block text-xs font-bold text-slate-600">Ends (optional)
          <input className={inputClass} min={settings.fromDate || undefined} onChange={settings.toDateInput} type="datetime-local" value={settings.toDate} />
        </label>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span>{settings.error ? <span className="text-sm font-medium text-rose-600" role="alert">{settings.error}</span> : settings.success ? <span className="text-sm font-medium text-emerald-600" role="status">{settings.success}</span> : null}</span>
        <button className="h-10 rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white disabled:opacity-50" disabled={!settings.isSupported || settings.isSaving} type="submit">
          {settings.isSaving ? "Saving..." : "Save automatic reply"}
        </button>
      </div>
    </fieldset>
    <p className="mt-3 text-[11px] text-slate-600">
      Mail delegation: {settings.delegationReason ?? "Available through this provider."}
    </p>
  </form>
);
