import { Check, PlugZap } from "lucide-react";

import type { MailServiceProviderViewModel } from "@/presentation/features/admin-mail-service/admin-mail-service.view-model";

export const MailServiceProviderListView = ({
  providers,
}: {
  readonly providers: readonly MailServiceProviderViewModel[];
}) => (
  <section aria-labelledby="provider-list-title">
    <h2
      className="text-xs font-extrabold uppercase tracking-[0.15em] text-slate-400"
      id="provider-list-title"
    >
      Mail provider
    </h2>
    <div className="mt-3 space-y-2">
      {providers.map((provider) => (
        <button
          aria-pressed={provider.isSelected}
          className={`flex w-full items-start gap-3 rounded-2xl border p-3 text-left transition ${
            provider.isSelected
              ? "border-indigo-200 bg-indigo-50/70 shadow-sm"
              : "border-slate-200 bg-white hover:border-indigo-200"
          }`}
          key={provider.id}
          onClick={provider.onSelect}
          type="button"
        >
          <span
            className={`grid size-9 shrink-0 place-items-center rounded-xl ${
              provider.isSelected
                ? "bg-[#302f77] text-white"
                : "bg-slate-100 text-slate-500"
            }`}
          >
            <PlugZap aria-hidden size={17} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 text-sm font-bold text-slate-800">
              {provider.name}
              {provider.isSelected ? (
                <Check aria-hidden className="text-emerald-500" size={14} />
              ) : null}
            </span>
            <span className="mt-0.5 block text-[11px] leading-4 text-slate-400">
              {provider.description}
            </span>
          </span>
        </button>
      ))}
    </div>
  </section>
);
