import { ShieldAlert, Trash2 } from "lucide-react";

import type { MailboxLifecycleViewModel } from "@/presentation/features/mail-workspace/mailbox-lifecycle.view-model";

export const MailboxLifecycleBannerView = ({
  lifecycle,
}: {
  readonly lifecycle: MailboxLifecycleViewModel;
}) => {
  if (!lifecycle.role) return null;
  const title = lifecycle.role === "spam" ? "Spam protection" : "Deleted messages";
  const description = lifecycle.role === "spam"
    ? "Move trusted messages back to Inbox with Not spam."
    : "Restore messages you still need before permanently deleting them.";
  const reasonId = "mailbox-empty-disabled-reason";
  return (
    <aside
      aria-label={`${lifecycle.role === "spam" ? "Spam" : "Trash"} lifecycle`}
      className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-amber-950"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0" aria-hidden>
          {lifecycle.role === "spam" ? <ShieldAlert size={18} /> : <Trash2 size={18} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-extrabold">{title}</p>
          <p className="mt-1 text-xs leading-5">{description}</p>
          <p className="mt-1 text-xs leading-5 text-amber-800">
            {lifecycle.retentionHint}
          </p>
          {lifecycle.disabledReason ? (
            <p className="mt-1 text-xs font-semibold" id={reasonId}>
              {lifecycle.disabledReason}
            </p>
          ) : null}
          {lifecycle.status ? (
            <p aria-live="polite" className="mt-1 text-xs font-semibold" role="status">
              {lifecycle.status}
            </p>
          ) : null}
          {lifecycle.error ? (
            <p className="mt-1 text-xs font-semibold text-red-800" role="alert">
              {lifecycle.error}
            </p>
          ) : null}
        </div>
        <button
          aria-busy={lifecycle.isBusy}
          aria-describedby={lifecycle.disabledReason ? reasonId : undefined}
          className="min-h-11 shrink-0 rounded-xl border border-red-300 bg-white px-3 text-xs font-extrabold text-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:cursor-not-allowed disabled:opacity-55"
          disabled={Boolean(lifecycle.disabledReason)}
          onClick={lifecycle.onRequestEmpty}
          type="button"
        >
          {lifecycle.isBusy ? "Emptying…" : lifecycle.emptyLabel}
        </button>
      </div>
    </aside>
  );
};
