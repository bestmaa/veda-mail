import { CalendarClock } from "lucide-react";

import type { ComposerViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";

export const ComposerScheduleDialogView = ({
  schedule,
}: {
  readonly schedule: ComposerViewModel["schedule"];
}) => schedule.isOpen ? (
  <div
    aria-describedby="composer-schedule-description"
    aria-labelledby="composer-schedule-title"
    aria-modal="true"
    className="absolute inset-0 z-20 grid place-items-center bg-slate-950/30 p-4"
    id="composer-schedule-dialog"
    role="dialog"
  >
    <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-indigo-50 text-indigo-700">
          <CalendarClock aria-hidden size={20} />
        </span>
        <div>
          <h2 className="font-bold text-slate-950" id="composer-schedule-title">
            Schedule send
          </h2>
          <p className="text-xs text-slate-600" id="composer-schedule-description">
            The server will send this saved draft even after you close the browser.
          </p>
        </div>
      </div>
      <label className="mt-5 block text-xs font-bold text-slate-700">
        Send date and time
        <input
          autoFocus
          className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100"
          disabled={schedule.isScheduling}
          max={schedule.maximum}
          min={schedule.minimum}
          onChange={schedule.onTimeInput}
          type="datetime-local"
          value={schedule.localTime}
        />
      </label>
      <p className="mt-2 text-xs text-slate-500">
        Time zone: {schedule.timeZone}. The exact UTC instant is stored securely.
      </p>
      {schedule.error ? (
        <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700" role="alert">
          {schedule.error}
        </p>
      ) : null}
      <div className="mt-5 flex justify-end gap-2">
        <button
          className="h-10 rounded-xl px-3 text-sm font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          disabled={schedule.isScheduling}
          onClick={schedule.onCancel}
          type="button"
        >
          Cancel
        </button>
        <button
          className="h-10 rounded-xl bg-indigo-700 px-4 text-sm font-bold text-white hover:bg-indigo-800 disabled:opacity-50"
          disabled={schedule.isScheduling}
          onClick={schedule.onConfirm}
          type="button"
        >
          {schedule.isScheduling ? "Scheduling…" : "Schedule send"}
        </button>
      </div>
    </div>
  </div>
) : null;
