import { Laptop, LoaderCircle, LogOut } from "lucide-react";

import type { MemberSessionsViewModel } from "@/presentation/features/mail-workspace/member-sessions.view-model";

const date = (value: string) => new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
}).format(new Date(value));

export const MemberSessionsView = ({
  sessions,
}: {
  readonly sessions: MemberSessionsViewModel;
}) => (
  <section aria-labelledby="member-active-sessions-title" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="mb-4 flex items-center gap-3">
      <Laptop aria-hidden className="text-indigo-600" size={20} />
      <div>
        <h3 className="font-bold text-slate-900" id="member-active-sessions-title">Active sessions</h3>
        <p className="text-xs text-slate-500">Review browsers signed in to this mailbox</p>
      </div>
    </div>
    {sessions.error ? <p className="mb-3 rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700" role="alert">{sessions.error}</p> : null}
    {sessions.isLoading || !sessions.snapshot ? (
      <div className="grid min-h-20 place-items-center"><LoaderCircle aria-label="Loading mailbox sessions" className="animate-spin text-indigo-500" size={21} /></div>
    ) : sessions.snapshot.sessions.length === 0 ? (
      <p className="rounded-xl bg-slate-50 px-3 py-3 text-xs text-slate-500">No active sessions.</p>
    ) : (
      <ul className="space-y-2">
        {sessions.snapshot.sessions.map((session) => (
          <li className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 px-3 py-3" key={session.id}>
            <span className="grid size-9 place-items-center rounded-xl bg-indigo-50 text-indigo-700"><Laptop aria-hidden size={17} /></span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-slate-800">{session.clientLabel}{session.current ? " · This browser" : ""}</p>
              <p className="text-[11px] text-slate-500">Last active {date(session.lastSeenAt)} · expires {date(session.expiresAt)}</p>
            </div>
            <button
              className="flex h-9 items-center gap-1.5 rounded-xl border border-rose-200 px-3 text-xs font-bold text-rose-700 disabled:opacity-50"
              disabled={sessions.isRevoking !== null}
              aria-label={`Revoke ${session.current ? "this browser session" : session.clientLabel ?? "session"}`}
              onClick={() => sessions.onRevoke(session.id)}
              type="button"
            >
              {sessions.isRevoking === session.id ? <LoaderCircle aria-hidden className="animate-spin" size={14} /> : <LogOut aria-hidden size={14} />}
              Revoke
            </button>
          </li>
        ))}
      </ul>
    )}
    {sessions.snapshot ? (
      <p className="mt-3 text-[11px] text-slate-500">
        Sessions close after {sessions.snapshot.policy.idleTtlSeconds / 60} minutes idle and never exceed {sessions.snapshot.policy.absoluteTtlSeconds / 3_600} hours.
      </p>
    ) : null}
  </section>
);
