import { Clock3 } from "lucide-react";
import type { MailSnoozeViewModel } from "@/presentation/features/mail-workspace/mail-snooze.view-model";

export const SnoozedSidebarButtonView = ({ snooze }: { readonly snooze: MailSnoozeViewModel }) =>
  snooze.supported || snooze.jobs.length ? <button className="flex h-11 w-full items-center gap-3 rounded-xl px-3 text-sm text-indigo-100/90 transition hover:bg-white/6 hover:text-white" onClick={snooze.manager.open} type="button"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/6"><Clock3 aria-hidden size={17} /></span><span className="min-w-0 flex-1 text-left">Snoozed</span>{snooze.jobs.length ? <span className="rounded-full bg-white/8 px-2 py-0.5 text-[11px] tabular-nums">{snooze.jobs.length}</span> : null}</button> : null;
