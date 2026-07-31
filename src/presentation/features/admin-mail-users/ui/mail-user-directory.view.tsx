import { LoaderCircle, Search, UserRound } from "lucide-react";

import type { AdminMailUsersViewProps } from "@/presentation/features/admin-mail-users/admin-mail-users.view-model";
import { MailUserDetailView } from "@/presentation/features/admin-mail-users/ui/mail-user-detail.view";

type DirectoryProps = Pick<
  AdminMailUsersViewProps,
  | "detail"
  | "create"
  | "domainInput"
  | "domains"
  | "isDetailLoading"
  | "isLoadingMore"
  | "items"
  | "nextCursor"
  | "onLoadMore"
  | "onSearch"
  | "search"
  | "searchInput"
  | "selectedDomain"
>;

export const MailUserDirectoryView = (model: DirectoryProps) => (
  <section className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
      <label className="block min-w-0 flex-1">
        <span className="mb-2 block text-xs font-bold">Allowed domain</span>
        <select className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100" disabled={model.create.isSubmitting} onChange={model.domainInput} value={model.selectedDomain}>
          {model.domains.map((domain) => <option key={domain} value={domain}>{domain}</option>)}
        </select>
      </label>
      <form className="flex min-w-0 flex-[1.4] gap-2" onSubmit={model.onSearch} role="search">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Search mailboxes</span>
          <input className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100" disabled={model.create.isSubmitting} maxLength={120} onChange={model.searchInput} placeholder="Search name or email" type="search" value={model.search} />
        </label>
        <button aria-label="Search mailboxes" className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#2f3274] text-white disabled:opacity-60" disabled={model.create.isSubmitting} type="submit"><Search aria-hidden size={17} /></button>
      </form>
    </div>
    <div className="mt-5 grid items-start gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(240px,.75fr)]">
      <div>
        <h3 className="text-sm font-extrabold">Mailboxes</h3>
        {model.items.length ? (
          <ul aria-label="Organization mailboxes" className="mt-3 space-y-2">
            {model.items.map((item) => (
              <li key={item.id}>
                <button className="flex w-full items-center gap-3 rounded-2xl border border-slate-100 p-3 text-left transition hover:border-indigo-200 hover:bg-indigo-50/50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-100" onClick={item.onOpen} type="button">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-700"><UserRound aria-hidden size={17} /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-extrabold">{item.displayName}</span><span className="block truncate text-xs text-slate-500">{item.email}</span></span>
                  <span className="hidden shrink-0 text-right text-[11px] text-slate-400 sm:block"><span className="block">{item.storageLabel}</span><span className="block">{item.createdLabel}</span></span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-xs font-semibold text-slate-500">No mailboxes match this domain and search.</p>
        )}
        {model.nextCursor ? (
          <button className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 text-xs font-bold hover:bg-slate-50 disabled:opacity-60" disabled={model.isLoadingMore} onClick={model.onLoadMore} type="button">
            {model.isLoadingMore ? <LoaderCircle aria-hidden className="animate-spin" size={15} /> : null}{model.isLoadingMore ? "Loading more…" : "Load more"}
          </button>
        ) : null}
      </div>
      <MailUserDetailView detail={model.detail} isLoading={model.isDetailLoading} />
    </div>
  </section>
);
