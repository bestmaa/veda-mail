import { Forward, LoaderCircle, ShieldAlert } from "lucide-react";

import type { AdminMailForwardingViewModel } from "@/presentation/features/admin-mail-users/admin-mail-users.view-model";

const field = "mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100";

export const MailForwardingView = ({ model }: {
  readonly model: AdminMailForwardingViewModel;
}) => (
  <section aria-labelledby="mail-forwarding-title" className="mt-4 border-t border-slate-200 pt-4">
    <div className="flex items-start gap-2">
      <Forward aria-hidden className="mt-0.5 text-indigo-600" size={16} />
      <div><h4 className="text-xs font-extrabold" id="mail-forwarding-title">Automatic forwarding</h4>
      <p className="mt-1 text-[11px] leading-5 text-slate-500">Admin-only. A local copy is always kept.</p></div>
    </div>
    {model.isLoading ? <LoaderCircle aria-label="Loading forwarding" className="mx-auto mt-5 animate-spin text-indigo-500" size={18} /> :
      model.availability !== "available" ? (
        <p className="mt-3 rounded-xl bg-amber-50 p-3 text-[11px] font-semibold leading-5 text-amber-900"><ShieldAlert aria-hidden className="mr-1 inline" size={13} />{model.reason ?? "Forwarding is unavailable."}</p>
      ) : (
        <>
          {model.error ? <p className="mt-3 text-xs font-semibold text-red-700" role="alert">{model.error}</p> : null}
          {model.success ? <p className="mt-3 text-xs font-semibold text-emerald-700" role="status">{model.success}</p> : null}
          {model.isEnabled ? <p className="mt-3 rounded-xl bg-indigo-50 p-3 text-[11px] leading-5 text-indigo-900">Status: <strong>{model.status}</strong>. Incoming mail is copied to <strong className="break-all">{model.destination}</strong>.</p> : null}
          <form className="mt-3 space-y-3" onSubmit={model.onEnable}>
            <label className="block text-[11px] font-bold">External destination<input autoComplete="off" className={field} disabled={model.isSaving} maxLength={320} onChange={model.destinationInput} placeholder="name@gmail.com" required type="email" value={model.destination} /></label>
            <label className="block text-[11px] font-bold">Confirm destination<input autoComplete="off" className={field} disabled={model.isSaving} maxLength={320} onChange={model.confirmationInput} required type="email" value={model.confirmation} /></label>
            <label className="block text-[11px] font-bold">Administrator password<input autoComplete="current-password" className={field} disabled={model.isSaving} onChange={model.adminPasswordInput} required type="password" value={model.adminPassword} /></label>
            {model.requiresOtp ? <label className="block text-[11px] font-bold">Verification code<input autoComplete="one-time-code" className={field} disabled={model.isSaving} inputMode="numeric" onChange={model.otpCodeInput} required value={model.otpCode} /></label> : null}
            <p className="text-[10px] leading-4 text-slate-500">Confirm ownership and consent with the destination owner. External delivery can still fail DMARC checks.</p>
            <div className="flex gap-2"><button className="h-9 flex-1 rounded-xl bg-indigo-600 px-3 text-xs font-bold text-white disabled:opacity-50" disabled={model.isSaving} type="submit">{model.isSaving ? "Applying…" : model.isEnabled ? "Update" : "Enable"}</button></div>
          </form>
          {model.isEnabled ? <form className="mt-2" onSubmit={model.onDisable}><button className="h-9 w-full rounded-xl border border-red-200 text-xs font-bold text-red-700 disabled:opacity-50" disabled={model.isSaving || !model.adminPassword} type="submit">Disable forwarding</button></form> : null}
        </>
      )}
  </section>
);
