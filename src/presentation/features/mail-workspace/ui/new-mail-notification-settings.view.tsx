import { Bell } from "lucide-react";
import type { NewMailNotificationViewModel } from "@/presentation/features/mail-workspace/new-mail-notification.view-model";

const permissionLabel = (notifications: NewMailNotificationViewModel) => {
  if (!notifications.isSupported) return "Not supported by this browser";
  if (notifications.webEnabled) return "Enabled";
  return notifications.permission === "denied" ?
    "Blocked in browser settings" : "Off";
};

export const NewMailNotificationSettingsView = ({ notifications }: {
  readonly notifications: NewMailNotificationViewModel;
}) => (
  <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="mb-4 flex items-center gap-3">
      <Bell aria-hidden className="text-indigo-600" size={20} />
      <div>
        <h3 className="font-bold text-slate-900">New-mail notifications</h3>
        <p className="text-xs text-slate-500">In-app alerts are automatic. Browser alerts are optional and work while this tab is open.</p>
      </div>
    </div>
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="text-xs font-bold text-slate-700">Browser notifications</p>
      <p className="mt-1 text-xs text-slate-600">Permission is requested only when you choose Enable.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {notifications.webEnabled ? (
          <button className="h-9 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-100" onClick={notifications.disable} type="button">Disable</button>
        ) : (
          <button className="h-9 rounded-xl bg-indigo-600 px-3 text-xs font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50" disabled={!notifications.isSupported || notifications.isEnabling || notifications.permission === "denied"} onClick={notifications.enable} type="button">
            {notifications.isEnabling ? "Requesting..." : "Enable"}
          </button>
        )}
        <span className="text-xs font-semibold text-slate-600">{permissionLabel(notifications)}</span>
      </div>
    </div>
    <fieldset className="mt-4 space-y-2">
      <legend className="text-xs font-bold text-slate-700">Content shown</legend>
      <label className="flex cursor-pointer gap-3 rounded-xl border border-slate-200 p-3 text-xs text-slate-700">
        <input checked={notifications.content === "private"} name="notification-content" onChange={notifications.onContentChange} type="radio" value="private" />
        <span><strong className="block">Private (recommended)</strong>Show only the number of new messages.</span>
      </label>
      <label className="flex cursor-pointer gap-3 rounded-xl border border-slate-200 p-3 text-xs text-slate-700">
        <input checked={notifications.content === "details"} name="notification-content" onChange={notifications.onContentChange} type="radio" value="details" />
        <span><strong className="block">Sender and subject</strong>May expose message details on a shared or locked screen.</span>
      </label>
    </fieldset>
    {notifications.error ? <p className="mt-3 text-sm font-medium text-rose-600" role="alert">{notifications.error}</p> : null}
    <p className="mt-3 text-[11px] text-slate-600">Veda Mail stores only this preference in your browser, never notification message content.</p>
  </section>
);
