import { ArrowRight, Settings2, ShieldAlert } from "lucide-react";

export const SetupRequiredView = ({
  adminHref,
}: {
  readonly adminHref: string;
}) => (
  <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-[#f4f5fb] p-4 text-slate-900">
    <div
      aria-hidden
      className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(99,102,241,0.13),transparent_32%),radial-gradient(circle_at_90%_85%,rgba(255,120,90,0.16),transparent_30%)]"
    />
    <section className="relative w-full max-w-md rounded-[30px] border border-white/80 bg-white/95 p-7 text-center shadow-2xl shadow-indigo-950/10 sm:p-9">
      <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-amber-50 text-amber-600">
        <ShieldAlert aria-hidden size={25} />
      </span>
      <h1 className="mt-6 text-3xl font-extrabold tracking-[-0.05em]">
        Mail service setup required
      </h1>
      <p className="mt-3 text-sm leading-6 text-slate-500">
        An administrator needs to choose the organization provider and allowed
        domains before members can sign in.
      </p>
      <a
        className="mt-7 inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#2f3274] px-5 text-sm font-bold text-white transition hover:bg-[#25285f]"
        href={adminHref}
      >
        <Settings2 aria-hidden size={17} />
        Open administrator setup
        <ArrowRight aria-hidden size={16} />
      </a>
      <p className="mt-5 text-[11px] font-semibold text-slate-400">
        Member credentials cannot configure or change the provider.
      </p>
    </section>
  </main>
);
