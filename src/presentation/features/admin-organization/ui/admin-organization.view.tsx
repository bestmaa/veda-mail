import {
  ExternalLink,
  ImagePlus,
  LoaderCircle,
  Save,
  Trash2,
} from "lucide-react";

import type { AdminOrganizationViewProps } from "@/presentation/features/admin-organization/admin-organization.view-model";

export const AdminOrganizationView = (
  model: AdminOrganizationViewProps,
) => (
  <section style={model.style}>
    <p className="text-[11px] font-extrabold uppercase tracking-[0.17em] text-[var(--brand-accent)]">
      White-label identity
    </p>
    <h2 className="mt-1 text-3xl font-extrabold tracking-[-0.05em]">Organization</h2>
    <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
      Customize the product name, visual identity, and public source-code link shown to your members.
    </p>
    {model.isLoading ? (
      <div className="mt-8 grid min-h-64 place-items-center rounded-[26px] border border-slate-200 bg-white">
        <LoaderCircle aria-label="Loading organization" className="animate-spin text-indigo-500" size={26} />
      </div>
    ) : (
      <form className="mt-8 grid gap-5 lg:grid-cols-[300px_1fr]" onSubmit={model.onSubmit}>
        <aside className="rounded-[26px] bg-[var(--brand-primary)] p-6 text-white shadow-xl">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">Live preview</p>
          <div className="mt-7 grid size-20 place-items-center overflow-hidden rounded-3xl bg-white/10">
            {model.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="Organization logo preview" className="size-full object-cover" src={model.logoUrl} />
            ) : (
              <span className="size-8 rotate-45 rounded-lg border-4 border-[var(--brand-accent)]" />
            )}
          </div>
          <p className="mt-5 text-2xl font-extrabold tracking-[-0.04em]">{model.productName || "Mail workspace"}</p>
          <p className="mt-1 text-sm text-white/60">{model.organizationName || "Your organization"}</p>
        </aside>
        <div className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block"><span className="mb-2 block text-xs font-bold">Organization name</span><input className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100" onChange={model.organizationNameInput} required value={model.organizationName} /></label>
            <label className="block"><span className="mb-2 block text-xs font-bold">Product name</span><input className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100" onChange={model.productNameInput} required value={model.productName} /></label>
            <label className="flex items-center gap-3 rounded-2xl border border-slate-200 p-3"><input aria-label="Primary color" className="size-9" onChange={model.primaryColorInput} type="color" value={model.primaryColor} /><span className="text-xs font-bold">Primary color<br /><span className="font-normal text-slate-400">{model.primaryColor}</span></span></label>
            <label className="flex items-center gap-3 rounded-2xl border border-slate-200 p-3"><input aria-label="Accent color" className="size-9" onChange={model.accentColorInput} type="color" value={model.accentColor} /><span className="text-xs font-bold">Accent color<br /><span className="font-normal text-slate-400">{model.accentColor}</span></span></label>
          </div>
          <label className="mt-4 flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-slate-300 p-4"><ImagePlus aria-hidden className="text-slate-400" size={20} /><span className="min-w-0 flex-1 truncate text-xs font-bold">{model.logoFileName ?? "Replace logo · PNG, JPEG, or WebP · max 2 MB"}</span><input accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={model.logoInput} type="file" /></label>
          {model.logoUrl || model.logoFileName ? (
            <button
              className="mt-2 flex items-center gap-2 text-xs font-bold text-red-600"
              onClick={model.onRemoveLogo}
              type="button"
            >
              <Trash2 aria-hidden size={14} />
              Remove organization logo
            </button>
          ) : null}
          {model.removeLogo ? (
            <p className="mt-2 text-xs font-semibold text-amber-700">
              The current logo will be removed when you save.
            </p>
          ) : null}
          <label className="mt-4 block"><span className="mb-2 flex items-center gap-1.5 text-xs font-bold">Public repository URL <ExternalLink aria-hidden size={13} /></span><input className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100" onChange={model.publicRepositoryUrlInput} placeholder="https://github.com/organization/project" type="url" value={model.publicRepositoryUrl} /></label>
          {model.error ? <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700" role="alert">{model.error}</p> : null}
          {model.success ? <p className="mt-4 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700" role="status">{model.success}</p> : null}
          <button className="mt-5 flex h-11 items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 text-sm font-bold text-white disabled:opacity-60" disabled={model.isSaving} type="submit">{model.isSaving ? <LoaderCircle aria-hidden className="animate-spin" size={16} /> : <Save aria-hidden size={16} />}{model.isSaving ? "Saving…" : "Save organization"}</button>
        </div>
      </form>
    )}
  </section>
);
