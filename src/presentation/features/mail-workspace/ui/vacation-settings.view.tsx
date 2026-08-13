import { CalendarClock, UserRoundCog } from "lucide-react";

import type { VacationSettingsViewModel } from "@/presentation/features/mail-workspace/vacation-settings.view-model";

const inputClass = "mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 disabled:bg-slate-50";

export const VacationSettingsView = ({ settings }: {
  readonly settings: VacationSettingsViewModel;
}) => (
  <section className="space-y-4">
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
        <div className="flex justify-end">
          <button className="h-10 rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white disabled:opacity-50" disabled={!settings.isSupported || settings.isSaving} type="submit">
            {settings.isSaving ? "Saving..." : "Save automatic reply"}
          </button>
        </div>
      </fieldset>
    </form>

    <form className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" onSubmit={settings.onDelegationSubmit}>
      <div className="mb-4 flex items-center gap-3">
        <UserRoundCog aria-hidden className="text-indigo-600" size={20} />
        <div><h3 className="font-bold text-slate-900">Inbox delegation</h3>
          <p className="text-xs text-slate-500">Standards-based mailbox access; this does not grant send-as identity</p></div>
      </div>
      {!settings.isLoading && !settings.isDelegationSupported ? (
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
          {settings.delegationReason ?? "Mail delegation is unavailable for this provider."}
        </p>
      ) : null}
      {settings.isDelegationSupported ? <>
        <div className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
          <label className="block text-xs font-bold text-slate-600">Account identifier
            <input autoComplete="off" className={inputClass} maxLength={320} onChange={settings.delegationIdentifierInput} placeholder="colleague@example.com" required value={settings.delegationIdentifier} />
          </label>
          <label className="block text-xs font-bold text-slate-600">Access
            <select className={inputClass} onChange={settings.delegationAccessInput} value={settings.delegationAccess}>
              <option value="read">Read only</option>
              <option value="manage">Manage mail</option>
            </select>
          </label>
          <button className="h-10 rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white disabled:opacity-50" disabled={settings.isDelegationSaving} type="submit">
            {settings.isDelegationSaving ? "Saving..." : "Grant access"}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-slate-600">Read only keeps seen state unchanged. Manage mail can change flags and delete or expunge messages, but cannot administer ACLs.</p>
        {settings.delegationEntries.length ? <ul className="mt-4 divide-y divide-slate-100" aria-label="Inbox delegates">
          {settings.delegationEntries.map((entry) => <li className="flex items-center justify-between gap-3 py-2" key={entry.identifier}>
            <span className="min-w-0 truncate text-sm text-slate-800">{entry.identifier} <span className="text-xs text-slate-500">({entry.access === "manage" ? "Manage mail" : "Read only"})</span></span>
            <button className="text-xs font-bold text-rose-700 disabled:opacity-50" disabled={settings.isDelegationSaving} onClick={() => settings.onDelegationDelete(entry.identifier)} type="button">Remove</button>
          </li>)}
        </ul> : <p className="mt-4 text-xs text-slate-500">No Inbox delegates.</p>}
      </> : null}
    </form>
    {settings.error ? <p className="text-sm font-medium text-rose-700" role="alert">{settings.error}</p> : null}
    {settings.success ? <p className="text-sm font-medium text-emerald-700" role="status">{settings.success}</p> : null}
  </section>
);
