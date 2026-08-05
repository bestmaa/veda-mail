import { Bell, X } from "lucide-react";
import type { NewMailNotificationViewModel } from "@/presentation/features/mail-workspace/new-mail-notification.view-model";

export const NewMailNotificationNoticeView = ({
  notifications,
}: {
  readonly notifications: NewMailNotificationViewModel;
}) => notifications.notice ? (
  <aside
    aria-atomic="true"
    aria-live="polite"
    className="fixed right-4 top-20 z-50 flex max-w-sm items-start gap-3 rounded-2xl border border-indigo-200 bg-white p-4 shadow-xl"
    role="status"
  >
    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-indigo-100 text-indigo-700">
      <Bell aria-hidden size={18} />
    </span>
    <div className="min-w-0 flex-1">
      <p className="text-sm font-bold text-slate-900">{notifications.notice.title}</p>
      <p className="mt-0.5 text-xs text-slate-600">{notifications.notice.body}</p>
    </div>
    <button aria-label="Dismiss new-mail notification" className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100" onClick={notifications.dismissNotice} type="button">
      <X aria-hidden size={16} />
    </button>
  </aside>
) : null;
