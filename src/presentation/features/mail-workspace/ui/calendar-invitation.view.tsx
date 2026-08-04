import { CalendarDays, Download, MapPin, ShieldAlert } from "lucide-react";

import type { CalendarTemporalValue } from "@/domain/mail/calendar";
import type {
  CalendarInvitationResponseChoice,
  CalendarInvitationViewItem,
  CalendarInvitationViewSnapshot,
} from "@/presentation/features/mail-workspace/calendar-invitation.view-model";

const temporalLabel = (value: CalendarTemporalValue): string => {
  if (value.kind === "date") return value.value;
  const zone = value.zone.kind === "utc"
    ? "UTC"
    : value.zone.kind === "iana"
      ? value.zone.id
      : "local time";
  return `${value.value.replace("T", " ")} ${zone}`;
};

const methodLabel = (method: CalendarInvitationViewItem["invitation"]["method"]) =>
  method === "REQUEST"
    ? "Invitation"
    : method === "CANCEL"
      ? "Cancellation"
      : method === "REPLY"
        ? "Attendee response"
        : "Calendar event";

interface CalendarInvitationViewProps {
  readonly busyAction: string | null;
  readonly error: string | null;
  readonly isExporting: boolean;
  readonly isLoading: boolean;
  readonly onExport: () => void;
  readonly onImport: (item: CalendarInvitationViewItem) => void;
  readonly onRespond: (
    item: CalendarInvitationViewItem,
    choice: CalendarInvitationResponseChoice,
  ) => void;
  readonly snapshot: CalendarInvitationViewSnapshot | null;
  readonly status: string | null;
}

export const CalendarInvitationView = ({
  busyAction,
  error,
  isExporting,
  isLoading,
  onExport,
  onImport,
  onRespond,
  snapshot,
  status,
}: CalendarInvitationViewProps) => {
  if (isLoading && !snapshot && !error) return null;
  if (!isLoading && !error && !snapshot?.invitations.length &&
      !snapshot?.invalidPartCount) return null;
  return (
    <section
      aria-busy={isLoading || busyAction !== null}
      aria-label="Calendar invitations"
      className="mt-6 space-y-3"
    >
      {isLoading ? (
        <div className="animate-pulse rounded-2xl border border-indigo-100 bg-indigo-50 p-5">
          <div className="h-4 w-36 rounded bg-indigo-100" />
          <div className="mt-3 h-7 w-2/3 rounded bg-indigo-100" />
        </div>
      ) : null}
      {error ? (
        <p className="rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {snapshot?.invalidPartCount ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
          {snapshot.invalidPartCount} malformed or unsupported calendar part
          {snapshot.invalidPartCount === 1 ? " was" : "s were"} blocked.
        </p>
      ) : null}
      {snapshot?.invitations.map((item) => {
        const event = item.invitation.event;
        const actionPrefix = item.part.id;
        return (
          <article
            className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-5"
            key={item.part.id}
          >
            <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.12em] text-indigo-700">
              <CalendarDays aria-hidden size={16} />
              {methodLabel(item.invitation.method)} · sequence {event.sequence}
            </p>
            <h3 className="mt-2 text-lg font-extrabold text-slate-900">
              {event.summary}
            </h3>
            <p className="mt-1 text-sm font-semibold text-slate-700">
              {temporalLabel(event.startsAt)}
              {event.endsAt ? ` – ${temporalLabel(event.endsAt)}` : ""}
            </p>
            {event.location ? (
              <p className="mt-2 flex items-start gap-2 text-sm text-slate-700">
                <MapPin aria-hidden className="mt-0.5 shrink-0" size={15} />
                {event.location}
              </p>
            ) : null}
            {event.organizer ? (
              <p className="mt-2 text-sm text-slate-700">
                Organizer: {event.organizer.name ?? event.organizer.email}
                {event.organizer.name ? ` <${event.organizer.email}>` : ""}
              </p>
            ) : null}
            {event.recurrenceRule ? (
              <p className="mt-1 text-xs text-slate-600">
                Repeats: {event.recurrenceRule.summary}
              </p>
            ) : null}
            {item.organizerMatchesSender === false ? (
              <p className="mt-3 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
                <ShieldAlert aria-hidden className="mt-0.5 shrink-0" size={16} />
                Sender and organizer addresses differ. Review carefully before responding.
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label={`Actions for ${event.summary}`}>
              {item.canRespond ? ([
                ["accepted", "Accept"],
                ["tentative", "Maybe"],
                ["declined", "Decline"],
              ] as const).map(([choice, text]) => (
                <button
                  className="rounded-xl bg-indigo-700 px-3.5 py-2 text-sm font-bold text-white transition hover:bg-indigo-800 disabled:cursor-wait disabled:opacity-60"
                  disabled={busyAction !== null}
                  key={choice}
                  onClick={() => onRespond(item, choice)}
                  type="button"
                >
                  {busyAction === `${actionPrefix}:${choice}` ? "Sending…" : text}
                </button>
              )) : null}
              <button
                className="rounded-xl border border-indigo-200 bg-white px-3.5 py-2 text-sm font-bold text-indigo-800 disabled:cursor-wait disabled:opacity-60"
                disabled={busyAction !== null}
                onClick={() => onImport(item)}
                type="button"
              >
                {busyAction === `${actionPrefix}:import` ? "Adding…" : "Add to calendar"}
              </button>
            </div>
          </article>
        );
      })}
      {snapshot?.invitations.length ? (
        <button
          className="flex items-center gap-2 rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-bold text-slate-700 disabled:cursor-wait disabled:opacity-60"
          disabled={isExporting}
          onClick={onExport}
          type="button"
        >
          <Download aria-hidden size={16} />
          {isExporting ? "Preparing export…" : "Export my calendar (.ics)"}
        </button>
      ) : null}
      <p aria-live="polite" className="sr-only" role="status">{status}</p>
    </section>
  );
};
