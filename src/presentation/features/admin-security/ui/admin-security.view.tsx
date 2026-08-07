import { KeyRound, LoaderCircle, Save, ShieldCheck } from "lucide-react";

import type { AdminSecurityViewProps } from "@/presentation/features/admin-security/admin-security.view-model";
import { AdminTwoFactorView } from "@/presentation/features/admin-security/ui/admin-two-factor.view";
import { AdminSessionsView } from "@/presentation/features/admin-security/ui/admin-sessions.view";

export const AdminSecurityView = (model: AdminSecurityViewProps) => (
  <section>
    <p className="text-[11px] font-extrabold uppercase tracking-[0.17em] text-[#b7331b]">
      Owner account
    </p>
    <h2 className="mt-1 text-3xl font-extrabold tracking-[-0.05em]">Security</h2>
    <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
      Change the administrator username or rotate its password. Mailbox
      credentials remain separate.
    </p>
    <div className="mt-8 grid gap-5 lg:grid-cols-[300px_1fr]">
      <aside className="rounded-[26px] bg-[#24265d] p-6 text-white shadow-xl">
        <span className="grid size-12 place-items-center rounded-2xl bg-white/10"><ShieldCheck aria-hidden size={23} /></span>
        <h3 className="mt-5 text-xl font-extrabold">Protected administration</h3>
        <p className="mt-2 text-xs leading-5 text-white/55">
          Passwords are hashed and never returned by the API. Every change
          requires the current password.
        </p>
      </aside>
      {model.isLoading ? (
        <div className="grid min-h-64 place-items-center rounded-[26px] border border-slate-200 bg-white"><LoaderCircle aria-label="Loading security" className="animate-spin text-indigo-500" size={26} /></div>
      ) : (
        <form className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm sm:p-7" onSubmit={model.onSubmit}>
          <label className="block"><span className="mb-2 block text-xs font-bold">Admin username</span><input autoComplete="username" className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100" onChange={model.usernameInput} required value={model.username} /></label>
          <label className="mt-4 block"><span className="mb-2 block text-xs font-bold">Current password</span><span className="flex h-12 items-center gap-3 rounded-2xl border border-slate-200 px-4 focus-within:border-indigo-400 focus-within:ring-4 focus-within:ring-indigo-100"><KeyRound aria-hidden className="text-slate-400" size={17} /><input autoComplete="current-password" className="min-w-0 flex-1 bg-transparent text-sm outline-none" onChange={model.currentPasswordInput} required type="password" value={model.currentPassword} /></span></label>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block"><span className="mb-2 block text-xs font-bold">New password <span className="font-normal text-slate-600">(optional)</span></span><input autoComplete="new-password" className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100" minLength={12} onChange={model.newPasswordInput} type="password" value={model.newPassword} /></label>
            <label className="block"><span className="mb-2 block text-xs font-bold">Confirm new password</span><input autoComplete="new-password" className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100" minLength={12} onChange={model.confirmationInput} type="password" value={model.confirmation} /></label>
          </div>
          {model.twoFactorEnabled ? (
            <label className="mt-4 block">
              <span className="mb-2 block text-xs font-bold">
                Authenticator or backup code
              </span>
              <input autoComplete="one-time-code" className="h-12 w-full rounded-2xl border border-slate-200 px-4 font-mono text-sm uppercase outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100" onChange={model.accountOtpCodeInput} required value={model.accountOtpCode} />
            </label>
          ) : null}
          {model.error ? <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700" role="alert">{model.error}</p> : null}
          {model.success ? <p className="mt-4 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700" role="status">{model.success}</p> : null}
          <button className="mt-5 flex h-11 items-center gap-2 rounded-xl bg-[#2f3274] px-4 text-sm font-bold text-white disabled:opacity-60" disabled={model.isSaving} type="submit">{model.isSaving ? <LoaderCircle aria-hidden className="animate-spin" size={16} /> : <Save aria-hidden size={16} />}{model.isSaving ? "Saving…" : "Update credentials"}</button>
        </form>
      )}
    </div>
    {!model.isLoading ? <AdminTwoFactorView {...model} /> : null}
    <AdminSessionsView model={model.sessions} />
  </section>
);
