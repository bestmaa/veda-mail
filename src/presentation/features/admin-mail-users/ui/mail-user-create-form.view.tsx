import { KeyRound, LoaderCircle, UserPlus } from "lucide-react";

import type { AdminMailUserCreateViewModel } from "@/presentation/features/admin-mail-users/admin-mail-users.view-model";

const inputClass =
  "h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 disabled:bg-slate-50";

export const MailUserCreateFormView = ({
  model,
}: {
  readonly model: AdminMailUserCreateViewModel;
}) => (
  <form
    aria-busy={model.isSubmitting}
    className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
    onSubmit={model.onSubmit}
  >
    <div className="flex items-center gap-3">
      <span className="grid size-10 place-items-center rounded-xl bg-orange-50 text-[#e55f43]"><UserPlus aria-hidden size={18} /></span>
      <div>
        <h3 className="text-base font-extrabold">Create mailbox</h3>
        <p className="text-xs text-slate-500">Passwords are sent once and never displayed later.</p>
      </div>
    </div>
    {!model.isAvailable && model.reason ? (
      <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2.5 text-xs font-semibold text-amber-800" role="status">{model.reason}</p>
    ) : null}
    <fieldset className="mt-5 space-y-4" disabled={!model.isAvailable || model.isSubmitting}>
      <legend className="sr-only">New mailbox details</legend>
      <label className="block">
        <span className="mb-2 block text-xs font-bold">Email address</span>
        <input autoComplete="off" className={inputClass} inputMode="email" maxLength={254} onChange={model.emailInput} placeholder={model.domain ? `name@${model.domain}` : "name@example.com"} required type="email" value={model.email} />
      </label>
      <label className="block">
        <span className="mb-2 block text-xs font-bold">Display name <span className="font-normal text-slate-400">(optional)</span></span>
        <input autoComplete="off" className={inputClass} maxLength={120} onChange={model.displayNameInput} value={model.displayName} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
        <label className="block"><span className="mb-2 block text-xs font-bold">Mailbox password</span><input autoComplete="new-password" className={inputClass} maxLength={1000} minLength={12} onChange={model.mailboxPasswordInput} required type="password" value={model.mailboxPassword} /></label>
        <label className="block"><span className="mb-2 block text-xs font-bold">Confirm mailbox password</span><input autoComplete="new-password" className={inputClass} maxLength={1000} minLength={12} onChange={model.confirmationInput} required type="password" value={model.confirmation} /></label>
      </div>
      <label className="block">
        <span className="mb-2 block text-xs font-bold">Current administrator password</span>
        <span className="flex h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 focus-within:border-indigo-400 focus-within:ring-4 focus-within:ring-indigo-100"><KeyRound aria-hidden className="text-slate-400" size={15} /><input autoComplete="current-password" className="min-w-0 flex-1 bg-transparent text-sm outline-none" maxLength={1024} onChange={model.adminPasswordInput} required type="password" value={model.adminPassword} /></span>
      </label>
      {model.requiresOtp ? (
        <label className="block"><span className="mb-2 block text-xs font-bold">Authenticator or backup code</span><input autoComplete="one-time-code" className={inputClass} maxLength={64} onChange={model.otpCodeInput} required value={model.otpCode} /></label>
      ) : null}
      <button className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#2f3274] px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60" type="submit">
        {model.isSubmitting ? <LoaderCircle aria-hidden className="animate-spin" size={16} /> : <UserPlus aria-hidden size={16} />}
        {model.isSubmitting ? "Creating mailbox…" : "Create mailbox"}
      </button>
    </fieldset>
  </form>
);
