import { AlertTriangle, X } from "lucide-react";

import type { DeliveryNoticeViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";

export const PartialDeliveryNoticeView = ({
  notice,
  placement = "workspace",
}: {
  readonly notice: DeliveryNoticeViewModel;
  readonly placement?: "composer" | "workspace";
}) => (
  <aside
    aria-label={
      notice.kind === "partial"
        ? "Partial delivery warning"
        : notice.kind === "uncertain"
          ? "Uncertain delivery warning"
          : "Delivery notice overflow warning"
    }
    className={`rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950 shadow-xl ${
      placement === "composer"
        ? "mx-3 mt-3 shrink-0"
        : "fixed inset-x-3 top-20 z-50 sm:left-auto sm:right-5 sm:w-[440px]"
    }`}
  >
    <div className="flex items-start gap-3">
      <AlertTriangle aria-hidden className="mt-0.5 shrink-0" size={20} />
      <div
        aria-atomic="true"
        aria-live="polite"
        className="min-w-0 flex-1"
        role="status"
      >
        {notice.kind === "partial" ? (
          <>
            <p className="font-bold">Message delivered only partially</p>
            <p className="mt-1 text-sm leading-5">
              Do not resend the message to everyone. Send a new message only to
              these addresses:
            </p>
            <p className="mt-1 text-sm leading-5">
              If you already retried them, dismiss this notice.
            </p>
            <ul
              aria-label="Rejected recipients. Use arrow keys to scroll."
              className="mt-2 max-h-36 list-disc overflow-y-auto pl-5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-800"
              tabIndex={0}
            >
              {notice.rejectedRecipients.map((recipient) => (
                <li className="break-all" key={recipient}>
                  {recipient}
                </li>
              ))}
            </ul>
          </>
        ) : notice.kind === "uncertain" ? (
          <>
            <p className="font-bold">Delivery status could not be verified</p>
            <p className="mt-1 text-sm leading-5">
              Check your Sent folder or mail provider before retrying. Sending
              again could deliver duplicate messages.
            </p>
          </>
        ) : (
          <>
            <p className="font-bold">
              Some delivery outcomes were not retained
            </p>
            <p className="mt-1 text-sm leading-5">
              Additional delivery outcomes weren’t retained. Review your Sent
              folder or mail provider before sending again.
            </p>
          </>
        )}
        {notice.pendingCount > 1 ? (
          <p className="mt-2 text-xs font-semibold">
            {notice.pendingCount} delivery notices need review.
          </p>
        ) : null}
        {notice.dismissError ? (
          <p className="mt-2 text-xs font-semibold text-red-800" role="alert">
            {notice.dismissError}
          </p>
        ) : null}
      </div>
      <button
        aria-label="Dismiss delivery warning"
        className="grid size-8 shrink-0 place-items-center rounded-lg hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-800 disabled:cursor-wait disabled:opacity-50"
        disabled={notice.isDismissing}
        onClick={notice.onDismiss}
        type="button"
      >
        <X aria-hidden size={17} />
      </button>
    </div>
  </aside>
);
