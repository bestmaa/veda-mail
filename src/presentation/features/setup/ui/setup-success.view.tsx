import { ArrowRight, CheckCircle2 } from "lucide-react";

export const SetupSuccessView = () => (
  <div className="py-6 text-center">
    <span className="mx-auto grid size-16 place-items-center rounded-3xl bg-emerald-50 text-emerald-600">
      <CheckCircle2 aria-hidden size={31} />
    </span>
    <h2 className="mt-6 text-3xl font-extrabold tracking-[-0.05em]">
      Your workspace is ready
    </h2>
    <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-500">
      The setup route is now locked. Continue to administration to manage your
      organization, mail service, and security.
    </p>
    <a className="mt-7 inline-flex h-12 items-center gap-2 rounded-2xl bg-[var(--brand-primary)] px-5 text-sm font-bold text-white" href="/admin">
      Open administration <ArrowRight aria-hidden size={17} />
    </a>
  </div>
);
