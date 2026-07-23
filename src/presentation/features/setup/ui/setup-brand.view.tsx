import { ArrowRight, ImagePlus, Palette } from "lucide-react";

import type { SetupWizardViewProps } from "@/presentation/features/setup/setup-wizard.view-model";

export const SetupBrandView = ({
  model,
}: {
  readonly model: SetupWizardViewProps;
}) => (
  <>
    <p className="text-xs font-extrabold uppercase tracking-[0.17em] text-[var(--brand-accent)]">
      White-label identity
    </p>
    <h2 className="mt-2 text-3xl font-extrabold tracking-[-0.05em]">
      Add your organization
    </h2>
    <p className="mt-2 text-sm leading-6 text-slate-500">
      Members will see this identity on the sign-in page and inside their
      mailbox workspace.
    </p>
    <div className="mt-7 grid gap-4 sm:grid-cols-2">
      <label className="block">
        <span className="mb-2 block text-xs font-bold">Organization name</span>
        <input className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100" onChange={model.organizationNameInput} placeholder="Acme Corporation" value={model.organizationName} />
      </label>
      <label className="block">
        <span className="mb-2 block text-xs font-bold">Product name</span>
        <input className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100" onChange={model.productNameInput} placeholder="Acme Mail" value={model.productName} />
      </label>
    </div>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <label className="flex items-center gap-3 rounded-2xl border border-slate-200 p-3">
        <input aria-label="Primary color" className="size-9 rounded-lg border-0 bg-transparent" onChange={model.primaryColorInput} type="color" value={model.primaryColor} />
        <span><span className="block text-xs font-bold">Primary color</span><span className="text-[11px] text-slate-400">{model.primaryColor}</span></span>
      </label>
      <label className="flex items-center gap-3 rounded-2xl border border-slate-200 p-3">
        <input aria-label="Accent color" className="size-9 rounded-lg border-0 bg-transparent" onChange={model.accentColorInput} type="color" value={model.accentColor} />
        <span><span className="block text-xs font-bold">Accent color</span><span className="text-[11px] text-slate-400">{model.accentColor}</span></span>
      </label>
    </div>
    <label className="mt-4 flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-slate-300 p-4 hover:border-indigo-300 hover:bg-indigo-50/40">
      <span className="grid size-10 place-items-center rounded-xl bg-slate-100 text-slate-500"><ImagePlus aria-hidden size={19} /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-bold">Organization logo</span>
        <span className="block truncate text-[11px] text-slate-400">{model.logoFileName ?? "PNG, JPEG, or WebP · maximum 2 MB"}</span>
      </span>
      <input accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" className="sr-only" onChange={model.logoInput} type="file" />
    </label>
    <label className="mt-4 block">
      <span className="mb-2 block text-xs font-bold">Public repository URL <span className="font-normal text-slate-400">(optional)</span></span>
      <input className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100" onChange={model.publicRepositoryUrlInput} placeholder="https://github.com/organization/project" type="url" value={model.publicRepositoryUrl} />
      <span className="mt-1.5 block text-[11px] text-slate-400">Shown as the required source-code link in the member and admin interfaces.</span>
    </label>
    <div className="mt-5 flex items-center gap-3 rounded-2xl bg-slate-50 p-4">
      <Palette aria-hidden className="text-[var(--brand-primary)]" size={20} />
      <span className="text-xs text-slate-500">Your selected colors are previewed across this setup screen.</span>
    </div>
    <button className="mt-7 flex h-12 items-center gap-2 rounded-2xl bg-[var(--brand-primary)] px-5 text-sm font-bold text-white" onClick={model.onNext} type="button">
      Continue <ArrowRight aria-hidden size={17} />
    </button>
  </>
);
