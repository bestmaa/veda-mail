import { LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";

import type { MemberSessionViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";

type PrivacyCurtainViewModel = MemberSessionViewModel["privacyCurtain"];

export const MemberSessionPrivacyCurtainView = ({
  privacy,
}: {
  readonly privacy: PrivacyCurtainViewModel;
}) => {
  if (!privacy.isOpen) return null;
  const hasFailed = !privacy.isPurging;

  return (
    <main className="grid min-h-dvh place-items-center bg-[#f8f9fc] p-5 text-slate-900">
      <section
        aria-busy={privacy.isPurging}
        aria-live={hasFailed ? "assertive" : "polite"}
        className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 text-center shadow-xl shadow-slate-950/8"
        role={hasFailed ? "alert" : "status"}
      >
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-indigo-50 text-indigo-800">
          {privacy.isPurging ? (
            <LoaderCircle aria-hidden className="animate-spin" size={28} />
          ) : (
            <ShieldCheck aria-hidden size={28} />
          )}
        </span>
        <h1 className="mt-5 text-xl font-bold">
          {privacy.isPurging
            ? "Finishing secure session cleanup"
            : "Mailbox session ended"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          {privacy.isPurging
            ? "Your mailbox is hidden while browser-local draft recovery for this session is removed from this device."
            : "Your mailbox remains hidden because browser-local draft recovery for this session could not be removed from this device."}
        </p>
        {hasFailed ? (
          <>
            <p className="mt-4 rounded-xl bg-red-50 p-3 text-left text-sm leading-6 text-red-800">
              {privacy.error ?? "Private recovery cleanup did not finish."}
            </p>
            <button
              autoFocus
              className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-indigo-800 px-4 text-sm font-bold text-white hover:bg-indigo-900"
              onClick={privacy.onRetryCleanup}
              type="button"
            >
              <RefreshCw aria-hidden size={17} />
              Retry secure cleanup
            </button>
          </>
        ) : null}
      </section>
    </main>
  );
};
