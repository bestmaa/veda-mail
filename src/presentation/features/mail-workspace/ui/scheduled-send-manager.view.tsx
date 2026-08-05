import { CalendarClock, RefreshCw, Trash2, X } from "lucide-react";

import type { ScheduledSendManagerViewModel } from "@/presentation/features/mail-workspace/scheduled-send-manager.view-model";
import { mailIntlLocale } from "@/domain/mail/message-list-preferences";

const statusLabel = {
  failed: "Failed",
  pending: "Scheduled",
  retrying: "Retrying",
  sending: "Sending",
  uncertain: "Needs review",
} as const;

const dateLabel = (
  value: string,
  manager: ScheduledSendManagerViewModel,
): string => new Intl.DateTimeFormat(mailIntlLocale(
  manager.locale ?? "en-IN",
), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: manager.timeZone,
  }).format(new Date(value));

export const ScheduledSendManagerView = ({
  manager,
}: {
  readonly manager: ScheduledSendManagerViewModel;
}) => manager.isOpen ? (
  <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/45 p-3" role="presentation">
    <section
      aria-labelledby="scheduled-send-manager-title"
      aria-modal="true"
      className="flex max-h-[min(760px,calc(100dvh-1.5rem))] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
      id="scheduled-send-manager-dialog"
      role="dialog"
    >
      <header className="flex items-center gap-3 border-b border-slate-200 px-5 py-4">
        <span className="grid size-10 place-items-center rounded-xl bg-indigo-50 text-indigo-700">
          <CalendarClock aria-hidden size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-bold text-slate-950" id="scheduled-send-manager-title">
            Scheduled messages
          </h2>
          <p className="text-xs text-slate-600">
            Encrypted server queue · {manager.timeZone}
          </p>
        </div>
        <button
          aria-label="Refresh scheduled messages"
          className="grid size-9 place-items-center rounded-xl text-slate-600 hover:bg-slate-100"
          disabled={manager.isLoading || manager.isMutating}
          onClick={manager.onRetry}
          type="button"
        >
          <RefreshCw aria-hidden className={manager.isLoading ? "animate-spin" : undefined} size={17} />
        </button>
        <button
          aria-label="Close scheduled messages"
          className="grid size-9 place-items-center rounded-xl text-slate-600 hover:bg-slate-100"
          disabled={manager.isMutating}
          onClick={manager.onClose}
          type="button"
        >
          <X aria-hidden size={18} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {manager.error ? (
          <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {manager.error}
          </p>
        ) : null}
        {manager.isLoading && manager.messages.length === 0 ? (
          <p className="py-12 text-center text-sm text-slate-500">Loading scheduled messages…</p>
        ) : manager.messages.length === 0 ? (
          <div className="py-12 text-center">
            <CalendarClock aria-hidden className="mx-auto text-slate-300" size={34} />
            <p className="mt-3 font-semibold text-slate-700">No scheduled messages</p>
            <p className="mt-1 text-sm text-slate-500">Use Schedule in the composer to add one.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {manager.messages.map((message) => (
              <li className="rounded-2xl border border-slate-200 p-4" key={message.id}>
                <div className="flex min-w-0 items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-slate-900">
                      {message.subject || "(No subject)"}
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      {dateLabel(message.scheduledAt, manager)} · {message.recipientCount} recipient{message.recipientCount === 1 ? "" : "s"}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-indigo-700">
                      {statusLabel[message.status]}
                      {message.attemptCount > 0 ? ` · attempt ${message.attemptCount}` : ""}
                    </p>
                    {message.lastError ? (
                      <p className="mt-2 text-xs text-red-700">{message.lastError}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {message.status !== "sending" && message.status !== "uncertain" ? (
                      <button
                        className="h-9 rounded-xl px-3 text-xs font-bold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                        disabled={manager.isMutating}
                        onClick={() => manager.onRequestReschedule(message)}
                        type="button"
                      >
                        Reschedule
                      </button>
                    ) : null}
                    {message.status !== "sending" ? (
                      <button
                        aria-label={message.status === "uncertain" ? "Remove review record" : "Cancel scheduled message"}
                        className="grid size-9 place-items-center rounded-xl text-red-700 hover:bg-red-50 disabled:opacity-50"
                        disabled={manager.isMutating}
                        onClick={() => manager.onCancelMessage(message)}
                        title={message.status === "uncertain" ? "Remove review record" : "Cancel schedule; keep provider draft"}
                        type="button"
                      >
                        <Trash2 aria-hidden size={16} />
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {manager.rescheduleTarget ? (
        <div className="border-t border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-bold text-slate-900">Choose a new send time</p>
          <input
            autoFocus
            className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
            disabled={manager.isMutating}
            max={manager.rescheduleMaximum}
            min={manager.rescheduleMinimum}
            onChange={manager.onRescheduleTimeInput}
            type="datetime-local"
            value={manager.rescheduleTime}
          />
          {manager.rescheduleError ? (
            <p className="mt-2 text-xs font-semibold text-red-700" role="alert">{manager.rescheduleError}</p>
          ) : null}
          <div className="mt-3 flex justify-end gap-2">
            <button className="h-9 rounded-xl px-3 text-xs font-bold text-slate-700" disabled={manager.isMutating} onClick={manager.onRescheduleCancel} type="button">Cancel</button>
            <button className="h-9 rounded-xl bg-indigo-700 px-3 text-xs font-bold text-white disabled:opacity-50" disabled={manager.isMutating} onClick={manager.onConfirmReschedule} type="button">{manager.isMutating ? "Saving…" : "Save time"}</button>
          </div>
        </div>
      ) : null}
    </section>
  </div>
) : null;
