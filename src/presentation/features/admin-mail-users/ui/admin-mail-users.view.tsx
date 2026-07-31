import { LoaderCircle, RefreshCw, UsersRound } from "lucide-react";

import type { AdminMailUsersViewProps } from "@/presentation/features/admin-mail-users/admin-mail-users.view-model";
import { MailUserCreateFormView } from "@/presentation/features/admin-mail-users/ui/mail-user-create-form.view";
import { MailUserDirectoryView } from "@/presentation/features/admin-mail-users/ui/mail-user-directory.view";

export const AdminMailUsersView = (model: AdminMailUsersViewProps) => (
  <section aria-labelledby="mailbox-users-title">
    <p className="text-[11px] font-extrabold uppercase tracking-[0.17em] text-[#ff785a]">Organization access</p>
    <h2 className="mt-1 text-3xl font-extrabold tracking-[-0.05em] sm:text-4xl" id="mailbox-users-title">Mailbox users</h2>
    <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Create member mailboxes and inspect non-secret account details for approved organization domains.</p>
    {model.error ? <p className="mt-5 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700" role="alert">{model.error}</p> : null}
    {model.success ? <p className="mt-5 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700" role="status">{model.success}</p> : null}
    {model.isLoading ? (
      <div aria-label="Loading mailbox users" className="mt-8 grid min-h-72 place-items-center rounded-[26px] border border-slate-200 bg-white">
        <div className="text-center text-slate-500"><LoaderCircle aria-hidden className="mx-auto animate-spin text-indigo-500" size={26} /><p className="mt-3 text-sm font-semibold">Loading mailboxes…</p></div>
      </div>
    ) : model.status === "available" ? (
      <div className="mt-8 grid items-start gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(310px,.75fr)]">
        <MailUserDirectoryView {...model} />
        <MailUserCreateFormView model={model.create} />
      </div>
    ) : (
      <div className="mt-8 rounded-[26px] border border-slate-200 bg-white p-7 text-center shadow-sm sm:p-10">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-indigo-50 text-indigo-700"><UsersRound aria-hidden size={22} /></span>
        <h3 className="mt-4 text-lg font-extrabold">{model.capabilityTitle ?? "Unable to load mailbox administration"}</h3>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-500">{model.capabilityDescription ?? "Retry the request. If it continues to fail, check the server configuration."}</p>
        <button className="mx-auto mt-5 flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-4 text-xs font-bold hover:bg-slate-50" onClick={model.onRetry} type="button"><RefreshCw aria-hidden size={15} />Retry</button>
      </div>
    )}
  </section>
);
