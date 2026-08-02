import { LoaderCircle, X } from "lucide-react";

import type { UndoSendViewModel } from "@/presentation/features/mail-workspace/undo-send.view-model";

export const UndoSendNoticeView = ({
  undo,
}: {
  readonly undo: UndoSendViewModel;
}) => undo.isVisible ? (
  <aside
    aria-atomic="true"
    aria-live="polite"
    className="fixed bottom-5 left-1/2 z-[85] w-[min(92vw,32rem)] -translate-x-1/2 rounded-2xl border border-indigo-200 bg-slate-950 px-4 py-3 text-white shadow-2xl"
  >
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold">Message queued: {undo.subject}</p>
        <p className="mt-0.5 text-xs text-slate-300">
          Undo available for {undo.secondsRemaining} second{undo.secondsRemaining === 1 ? "" : "s"}.
        </p>
      </div>
      <button
        className="h-10 rounded-xl bg-white px-4 text-sm font-bold text-indigo-800 hover:bg-indigo-50 disabled:opacity-60"
        disabled={undo.isUndoing}
        onClick={undo.onUndo}
        type="button"
      >
        {undo.isUndoing ? <LoaderCircle aria-hidden className="animate-spin" size={16} /> : "Undo"}
      </button>
      <button
        aria-label="Dismiss undo send notice"
        className="grid size-10 place-items-center rounded-xl text-slate-300 hover:bg-white/10 hover:text-white"
        onClick={undo.onDismiss}
        type="button"
      >
        <X aria-hidden size={17} />
      </button>
    </div>
    {undo.error ? <p className="mt-2 text-xs text-red-300" role="alert">{undo.error}</p> : null}
  </aside>
) : null;
