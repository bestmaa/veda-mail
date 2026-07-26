import { LogOut, PenLine, Settings, X } from "lucide-react";

import type {
  FolderViewModel,
  MailWorkspaceViewProps,
} from "@/presentation/features/mail-workspace/mail-workspace.view-model";
import { MailboxIconView } from "@/presentation/features/mail-workspace/ui/mailbox-icon.view";

interface MailSidebarViewProps {
  readonly account: MailWorkspaceViewProps["account"];
  readonly branding: MailWorkspaceViewProps["branding"];
  readonly folders: readonly FolderViewModel[];
  readonly isMobileOpen: boolean;
  readonly onCloseNavigation: () => void;
  readonly onCompose: () => void;
  readonly session: MailWorkspaceViewProps["session"];
  readonly settings: MailWorkspaceViewProps["settings"];
}

export const MailSidebarView = ({
  account,
  branding,
  folders,
  isMobileOpen,
  onCloseNavigation,
  onCompose,
  session,
  settings,
}: MailSidebarViewProps) => (
  <aside
    className={`mail-sidebar fixed inset-y-0 left-0 z-50 flex w-[252px] min-h-0 flex-col border-r border-white/8 transition-transform duration-200 md:static md:z-auto md:w-auto md:translate-x-0 ${
      isMobileOpen ? "translate-x-0" : "-translate-x-full"
    }`}
  >
    <button
      aria-label="Close navigation"
      className="absolute right-3 top-3 grid size-9 place-items-center rounded-xl text-indigo-100/60 hover:bg-white/10 hover:text-white md:hidden"
      onClick={onCloseNavigation}
      type="button"
    >
      <X aria-hidden size={18} />
    </button>
    <div className="mx-4 mt-5 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/7 p-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#ff8a65] to-[#ff5b5b] text-sm font-bold text-white shadow-lg shadow-orange-950/20">
        {account.avatar}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-white">
          {account.name}
        </span>
        <span className="block truncate text-xs text-indigo-200/70">
          {account.email}
        </span>
        <span className="mt-0.5 block truncate text-[10px] uppercase tracking-[0.08em] text-indigo-200/40">
          {account.provider}
        </span>
      </span>
    </div>

    <button
      className="mx-4 mt-4 flex h-12 items-center justify-center gap-2 rounded-2xl bg-[var(--brand-accent)] px-4 text-sm font-bold text-white shadow-lg transition hover:-translate-y-0.5"
      onClick={onCompose}
      type="button"
    >
      <PenLine aria-hidden size={18} />
      New message
    </button>

    <nav aria-label="Mail folders" className="mt-6 min-h-0 flex-1 overflow-y-auto px-3">
      <p className="mb-2 px-3 text-[11px] font-bold uppercase tracking-[0.18em] text-indigo-200/40">
        Mailboxes
      </p>
      <div className="space-y-1">
        {folders.map((folder) => (
          <button
            className={`group flex h-11 w-full items-center gap-3 rounded-xl px-3 text-sm transition ${
              folder.isActive
                ? "bg-white/12 font-semibold text-white"
                : "text-indigo-100/65 hover:bg-white/6 hover:text-white"
            }`}
            key={folder.id}
            onClick={folder.onSelect}
            type="button"
          >
            <span
              className="grid size-8 place-items-center rounded-lg bg-white/6"
              style={{ color: folder.color }}
            >
              <MailboxIconView icon={folder.icon} />
            </span>
            <span className="flex-1 text-left">{folder.label}</span>
            {folder.count > 0 ? (
              <span className="rounded-full bg-white/8 px-2 py-0.5 text-[11px] tabular-nums text-indigo-100/65">
                {folder.count}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </nav>

    <div className="m-4">
      <button
        className="flex h-11 w-full items-center gap-3 rounded-xl px-3 text-sm text-indigo-100/65 transition hover:bg-white/7 hover:text-white"
        onClick={settings.open}
        type="button"
      >
        <Settings aria-hidden size={18} />
        Profile &amp; security
      </button>
      {session.canSignOut ? (
        <button
          aria-busy={session.isSigningOut}
          className="flex h-11 w-full items-center gap-3 rounded-xl px-3 text-sm text-indigo-100/50 transition hover:bg-white/7 hover:text-white"
          disabled={session.isSigningOut}
          onClick={session.onSignOut}
          type="button"
        >
          <LogOut aria-hidden size={18} />
          {session.isSigningOut ? "Signing out…" : "Sign out"}
        </button>
      ) : null}
      {branding.publicRepositoryUrl ? (
        <a className="mt-2 block px-3 text-[10px] font-semibold text-indigo-100/35 hover:text-white" href={branding.publicRepositoryUrl} rel="noreferrer" target="_blank">
          Open-source code
        </a>
      ) : null}
    </div>
  </aside>
);
