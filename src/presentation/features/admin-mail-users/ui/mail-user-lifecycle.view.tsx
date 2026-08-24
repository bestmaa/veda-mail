import { LoaderCircle, ShieldAlert, UserRoundX } from "lucide-react";

import type { AdminMailUserLifecycleViewModel } from "@/presentation/features/admin-mail-users/admin-mail-users.view-model";

const field = "mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100";

export const MailUserLifecycleView = ({ model }: {
  readonly model: AdminMailUserLifecycleViewModel;
}) => (
  <section aria-labelledby="mailbox-lifecycle-title" className="border-t border-slate-200 pt-4">
    <div className="flex items-start gap-2">
      <UserRoundX aria-hidden className="mt-0.5 text-red-600" size={16} />
      <div>
        <h4 className="text-xs font-extrabold" id="mailbox-lifecycle-title">Mailbox lifecycle</h4>
        <p className="mt-1 text-[11px] leading-5 text-slate-500">Admin-only access removal and permanent deletion.</p>
      </div>
    </div>
    {model.protected || !model.available ? (
      <p className="mt-3 rounded-xl bg-amber-50 p-3 text-[11px] font-semibold leading-5 text-amber-900">
        <ShieldAlert aria-hidden className="mr-1 inline" size={13} />
        {model.protected
          ? "This operational or automation mailbox is protected."
          : "Lifecycle actions are unavailable for this mailbox."}
      </p>
    ) : model.operation ? (
      <form className="mt-3 space-y-3 rounded-xl border border-red-100 bg-red-50/60 p-3" onSubmit={model.onSubmit}>
        <p className="text-[11px] font-bold leading-5 text-red-900">
          {model.operation === "delete"
            ? "Permanent deletion is irreversible and removes the mailbox plus all provider data."
            : "Disable access removes all mailbox credentials, revokes active sessions and preserves mailbox data. Re-enabling requires setting new credentials in Stalwart."}
        </p>
        <label className="block text-[11px] font-bold">Type the full mailbox email
          <input autoComplete="off" className={field} disabled={model.isSaving} maxLength={320} onChange={model.confirmationInput} placeholder={model.email ?? ""} required type="email" value={model.confirmation} />
        </label>
        <label className="block text-[11px] font-bold">Administrator password
          <input autoComplete="current-password" className={field} disabled={model.isSaving} onChange={model.adminPasswordInput} required type="password" value={model.adminPassword} />
        </label>
        {model.requiresOtp ? <label className="block text-[11px] font-bold">Verification or backup code
          <input autoComplete="one-time-code" className={field} disabled={model.isSaving} onChange={model.otpCodeInput} required value={model.otpCode} />
        </label> : null}
        <div className="flex gap-2">
          <button className="h-9 flex-1 rounded-xl border border-slate-200 bg-white text-xs font-bold" disabled={model.isSaving} onClick={model.onCancel} type="button">Cancel</button>
          <button className="h-9 flex-1 rounded-xl bg-red-700 text-xs font-bold text-white disabled:opacity-50" disabled={model.isSaving || model.confirmation !== model.email} type="submit">
            {model.isSaving ? <><LoaderCircle aria-hidden className="mr-1 inline animate-spin" size={13} />Applying…</> : model.operation === "delete" ? "Permanently delete" : "Disable access"}
          </button>
        </div>
      </form>
    ) : (
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button className="min-h-10 rounded-xl border border-amber-200 bg-amber-50 px-2 text-xs font-bold text-amber-900" onClick={model.onDisable} type="button">Disable access</button>
        <button className="min-h-10 rounded-xl border border-red-200 bg-red-50 px-2 text-xs font-bold text-red-800" onClick={model.onDelete} type="button">Delete permanently</button>
      </div>
    )}
  </section>
);
