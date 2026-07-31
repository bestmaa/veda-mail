import { LoaderCircle, Mail, MapPin, Tag } from "lucide-react";

import type { AdminMailUserDetailViewModel } from "@/presentation/features/admin-mail-users/admin-mail-users.view-model";

export const MailUserDetailView = ({
  detail,
  isLoading,
}: {
  readonly detail: AdminMailUserDetailViewModel | null;
  readonly isLoading: boolean;
}) => (
  <section
    aria-busy={isLoading}
    aria-labelledby="mailbox-detail-title"
    className="rounded-[22px] border border-slate-200 bg-slate-50 p-5"
  >
    <h3 className="text-sm font-extrabold" id="mailbox-detail-title">
      Mailbox details
    </h3>
    {isLoading ? (
      <div className="grid min-h-44 place-items-center text-slate-500">
        <LoaderCircle aria-label="Loading mailbox details" className="animate-spin" size={22} />
      </div>
    ) : detail ? (
      <div className="mt-4 space-y-4 text-sm">
        <div>
          <p className="font-extrabold text-slate-900">{detail.displayName}</p>
          <p className="mt-1 break-all text-xs text-slate-500">{detail.email}</p>
        </div>
        <dl className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <div><dt className="font-bold text-slate-400">Created</dt><dd className="mt-1 font-semibold">{detail.createdLabel}</dd></div>
          <div><dt className="font-bold text-slate-400">Storage</dt><dd className="mt-1 font-semibold">{detail.storageLabel}</dd></div>
          <div><dt className="font-bold text-slate-400">Locale</dt><dd className="mt-1 flex items-center gap-1.5 font-semibold"><MapPin aria-hidden size={13} />{detail.locale}</dd></div>
          <div><dt className="font-bold text-slate-400">Time zone</dt><dd className="mt-1 font-semibold">{detail.timeZone}</dd></div>
        </dl>
        <div>
          <p className="flex items-center gap-1.5 text-xs font-bold text-slate-400"><Tag aria-hidden size={13} />Aliases</p>
          {detail.aliases.length ? (
            <ul aria-label="Mailbox aliases" className="mt-2 space-y-1">
              {detail.aliases.map((alias) => <li className="break-all text-xs font-semibold" key={alias}>{alias}</li>)}
            </ul>
          ) : <p className="mt-2 text-xs text-slate-500">No aliases</p>}
        </div>
      </div>
    ) : (
      <div className="grid min-h-44 place-items-center text-center text-slate-400">
        <div><Mail aria-hidden className="mx-auto" size={22} /><p className="mt-2 text-xs font-semibold">Select a mailbox to inspect safe account details.</p></div>
      </div>
    )}
  </section>
);
