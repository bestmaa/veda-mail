import { ArrowLeft, LoaderCircle, ShieldCheck } from "lucide-react";

import type {
  SetupContent,
  SetupWizardViewProps,
} from "@/presentation/features/setup/setup-wizard.view-model";

interface SetupLayoutViewProps {
  readonly children: SetupContent;
  readonly footer: SetupContent;
  readonly model: SetupWizardViewProps;
}

export const SetupLayoutView = ({
  children,
  footer,
  model,
}: SetupLayoutViewProps) => (
  <main
    className="relative min-h-dvh overflow-hidden bg-[#f4f5fb] p-4 text-slate-900 sm:p-6"
    style={model.style}
  >
    <div
      aria-hidden
      className="absolute inset-0 bg-[radial-gradient(circle_at_15%_0%,color-mix(in_srgb,var(--brand-primary)_14%,transparent),transparent_34%),radial-gradient(circle_at_95%_85%,color-mix(in_srgb,var(--brand-accent)_18%,transparent),transparent_30%)]"
    />
    <div className="relative mx-auto flex min-h-[calc(100dvh-2rem)] max-w-5xl flex-col">
      <header className="flex items-center gap-3 py-2">
        <span className="grid size-11 place-items-center rounded-2xl bg-[var(--brand-primary)] shadow-lg">
          <span className="size-4 rotate-45 rounded-[5px] border-[3px] border-[var(--brand-accent)]" />
        </span>
        <div>
          <p className="text-lg font-extrabold tracking-[-0.04em]">
            {model.productName}
          </p>
          <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-slate-400">
            private installation
          </p>
        </div>
        <span className="flex-1" />
        <p className="hidden items-center gap-2 text-xs font-semibold text-slate-500 sm:flex">
          <ShieldCheck aria-hidden size={15} />
          Setup stays on your server
        </p>
      </header>

      <div className="grid flex-1 items-center py-6 lg:grid-cols-[260px_1fr] lg:gap-8">
        <aside className="mb-5 rounded-[24px] bg-[var(--brand-primary)] p-5 text-white shadow-xl lg:mb-0 lg:self-stretch lg:p-7">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">
            First-run setup
          </p>
          <h1 className="mt-3 text-2xl font-extrabold tracking-[-0.05em]">
            Make this mail workspace yours.
          </h1>
          <ol className="mt-7 grid grid-cols-5 gap-2 lg:grid-cols-1">
            {model.steps.map((step) => (
              <li
                className={`flex items-center gap-3 rounded-xl px-2 py-2 text-xs font-bold ${
                  step.isActive ? "bg-white/12 text-white" : "text-white/45"
                }`}
                key={step.id}
              >
                <span className="grid size-6 shrink-0 place-items-center rounded-full border border-white/20 text-[10px]">
                  {step.number}
                </span>
                <span className="hidden lg:inline">{step.label}</span>
              </li>
            ))}
          </ol>
        </aside>

        <section className="rounded-[30px] border border-white/80 bg-white/95 p-6 shadow-2xl shadow-indigo-950/10 sm:p-9">
          {model.isLoading ? (
            <div className="grid min-h-80 place-items-center text-center text-slate-500">
              <div>
                <LoaderCircle className="mx-auto animate-spin" size={28} />
                <p className="mt-3 text-sm font-semibold">Preparing secure setup…</p>
              </div>
            </div>
          ) : (
            <>
              {model.canGoBack && !model.success ? (
                <button
                  className="mb-5 flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-slate-900"
                  onClick={model.onBack}
                  type="button"
                >
                  <ArrowLeft aria-hidden size={15} />
                  Back
                </button>
              ) : null}
              {children}
              {model.error ? (
                <p className="mt-5 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700" role="alert">
                  {model.error}
                </p>
              ) : null}
              {footer}
            </>
          )}
        </section>
      </div>
    </div>
  </main>
);
