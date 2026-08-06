import { Laptop, LoaderCircle, LogOut, Server } from "lucide-react";

import type {
  ActiveSessionViewModel,
  AdminSessionModel,
} from "@/presentation/features/admin-security/admin-session.view-model";

const date = (value: string) => new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
}).format(new Date(value));

const SessionList = ({
  kind,
  model,
  sessions,
}: {
  readonly kind: "administrator" | "member";
  readonly model: AdminSessionModel;
  readonly sessions: readonly ActiveSessionViewModel[];
}) => sessions.length === 0 ? (
  <p className="rounded-xl bg-slate-50 px-3 py-3 text-xs text-slate-500">No active sessions.</p>
) : (
  <ul className="space-y-2">
    {sessions.map((session) => (
      <li className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 px-3 py-3" key={session.id}>
        <span className="grid size-9 place-items-center rounded-xl bg-indigo-50 text-indigo-700">
          {kind === "administrator" ? <Laptop aria-hidden size={17} /> : <Server aria-hidden size={17} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-slate-800">
            {session.current ? "This administrator session" : session.clientLabel ?? "Administrator session"}
          </p>
          {session.ownerReference ? (
            <p className="text-[11px] text-slate-500">
              Mailbox {session.ownerReference} · {session.providerId}
            </p>
          ) : null}
          <p className="text-[11px] text-slate-500">
            Last active {date(session.lastSeenAt)} · expires {date(session.expiresAt)}
          </p>
        </div>
        <button
          className="flex h-9 items-center gap-1.5 rounded-xl border border-rose-200 px-3 text-xs font-bold text-rose-700 disabled:opacity-50"
          disabled={model.isRevoking !== null}
          aria-label={`Revoke ${session.current ? "this administrator session" : session.clientLabel ?? "session"}`}
          onClick={() => model.onRevoke(session.id, kind)}
          type="button"
        >
          {model.isRevoking === session.id ? <LoaderCircle aria-hidden className="animate-spin" size={14} /> : <LogOut aria-hidden size={14} />}
          Revoke
        </button>
      </li>
    ))}
  </ul>
);

export const AdminSessionsView = ({ model }: { readonly model: AdminSessionModel }) => (
  <section aria-labelledby="admin-active-sessions-title" className="mt-5 rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
    <h3 className="text-lg font-extrabold text-slate-900" id="admin-active-sessions-title">Active sessions</h3>
    <p className="mt-1 text-xs leading-5 text-slate-500">
      Review administrator and mailbox sessions. Management IDs are privacy-safe and cannot be used to sign in.
    </p>
    {model.error ? <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700" role="alert">{model.error}</p> : null}
    {model.isLoading || !model.snapshot ? (
      <div className="grid min-h-28 place-items-center"><LoaderCircle aria-label="Loading active sessions" className="animate-spin text-indigo-500" size={22} /></div>
    ) : (
      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <div><h4 className="mb-2 text-xs font-extrabold uppercase tracking-wide text-slate-500">Administrators</h4><SessionList kind="administrator" model={model} sessions={model.snapshot.administrator} /></div>
        <div><h4 className="mb-2 text-xs font-extrabold uppercase tracking-wide text-slate-500">Mailbox members</h4><SessionList kind="member" model={model} sessions={model.snapshot.member} /></div>
      </div>
    )}
  </section>
);
