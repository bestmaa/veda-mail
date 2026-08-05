import { CloudCheck, RefreshCw, WifiOff } from "lucide-react";

import type { MailConnectivityViewModel } from "@/presentation/features/mail-workspace/mail-connectivity";

export const MailConnectivityStatusView = ({
  connectivity,
}: {
  readonly connectivity: MailConnectivityViewModel;
}) => {
  if (!connectivity.phase) return null;
  const warning = connectivity.phase === "offline" ||
    connectivity.phase === "stale";
  const Icon = warning ? WifiOff : CloudCheck;
  return (
    <aside
      aria-atomic="true"
      aria-busy={connectivity.isBusy}
      className={`fixed left-1/2 top-[76px] z-30 flex w-[min(92vw,34rem)] -translate-x-1/2 items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-semibold shadow-lg ${
        warning
          ? "border-amber-300 bg-amber-50 text-amber-950"
          : "border-emerald-200 bg-emerald-50 text-emerald-900"
      }`}
      role={warning ? "alert" : "status"}
    >
      <Icon aria-hidden className="shrink-0" size={18} />
      <span className="min-w-0 flex-1">{connectivity.message}</span>
      {connectivity.canRetry ? (
        <button
          className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-xl border border-amber-400 bg-white px-3 text-xs font-bold hover:bg-amber-100"
          onClick={connectivity.onRetry}
          type="button"
        >
          <RefreshCw aria-hidden size={14} />Retry now
        </button>
      ) : null}
    </aside>
  );
};
