import { CalendarClock } from "lucide-react";

import type { ScheduledSendManagerViewModel } from "@/presentation/features/mail-workspace/scheduled-send-manager.view-model";

export const ScheduledSidebarButtonView = ({
  scheduled,
}: {
  readonly scheduled: ScheduledSendManagerViewModel;
}) => (
  <button
    className="mb-2 flex h-11 w-full items-center gap-3 rounded-xl px-3 text-sm text-indigo-100/90 transition hover:bg-white/6 hover:text-white"
    onClick={scheduled.onOpen}
    type="button"
  >
    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/6 text-amber-200">
      <CalendarClock aria-hidden size={17} />
    </span>
    <span className="min-w-0 flex-1 text-left">
      {scheduled.isAvailable ? "Scheduled" : "Scheduled setup"}
    </span>
    {scheduled.count > 0 ? (
      <span className="rounded-full bg-white/8 px-2 py-0.5 text-[11px] tabular-nums">
        {scheduled.count}
      </span>
    ) : null}
  </button>
);
