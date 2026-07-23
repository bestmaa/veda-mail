import { ExternalLink, LogOut, Settings2, ShieldCheck } from "lucide-react";

import type {
  AdminDashboardContent,
  AdminDashboardViewProps,
} from "@/presentation/features/admin-dashboard/admin-dashboard.view-model";
import { BrandMarkView } from "@/presentation/shared/branding/ui/brand-mark.view";

export const AdminDashboardView = ({
  children,
  model,
}: {
  readonly children: AdminDashboardContent;
  readonly model: AdminDashboardViewProps;
}) => (
  <main
    className="min-h-dvh bg-[#f5f6fa] text-slate-900"
    style={model.branding.brandStyle}
  >
    <header className="border-b border-slate-200/80 bg-white">
      <div className="mx-auto flex min-h-18 max-w-7xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
        <BrandMarkView branding={model.branding} size="sm" />
        <div>
          <p className="text-[17px] font-extrabold tracking-[-0.03em]">
            {model.branding.productName}
          </p>
          <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">
            <ShieldCheck aria-hidden size={11} /> administration
          </p>
        </div>
        <span className="flex-1" />
        {model.branding.publicRepositoryUrl ? (
          <a
            className="hidden items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-900 sm:flex"
            href={model.branding.publicRepositoryUrl}
            rel="noreferrer"
            target="_blank"
          >
            Source <ExternalLink aria-hidden size={14} />
          </a>
        ) : null}
        <button
          className="flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-60"
          disabled={model.isSigningOut}
          onClick={model.onSignOut}
          type="button"
        >
          <LogOut aria-hidden size={17} />
          {model.isSigningOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </header>
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-9">
      <div className="mb-7 flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-indigo-50 text-[var(--brand-primary)]">
          <Settings2 aria-hidden size={19} />
        </span>
        <div>
          <h1 className="text-2xl font-extrabold tracking-[-0.04em]">Administration</h1>
          <p className="text-xs text-slate-500">{model.branding.organizationName}</p>
        </div>
      </div>
      <nav aria-label="Administration sections" className="mb-7 flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
        {model.navigation.map((item) => (
          <button
            aria-current={item.isActive ? "page" : undefined}
            className={`min-w-max rounded-xl px-4 py-2.5 text-sm font-bold transition ${
              item.isActive
                ? "bg-[var(--brand-primary)] text-white"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            }`}
            key={item.id}
            onClick={item.onSelect}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </nav>
      {children}
    </div>
  </main>
);
