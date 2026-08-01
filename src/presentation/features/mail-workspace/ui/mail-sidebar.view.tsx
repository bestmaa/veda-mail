import { LoaderCircle, LogOut, MoreHorizontal, PenLine, Plus, Settings, X } from "lucide-react";

import type {
  FolderViewModel,
  MailWorkspaceViewProps,
} from "@/presentation/features/mail-workspace/mail-workspace.view-model";
import { MailboxIconView } from "@/presentation/features/mail-workspace/ui/mailbox-icon.view";

interface MailSidebarViewProps {
  readonly account: MailWorkspaceViewProps["account"];
  readonly branding: MailWorkspaceViewProps["branding"];
  readonly folders: readonly FolderViewModel[];
  readonly isComposerReady: boolean;
  readonly isMobileOpen: boolean;
  readonly mailboxManagement: MailWorkspaceViewProps["mailboxManagement"];
  readonly labelManagement: MailWorkspaceViewProps["labelManagement"];
  readonly onCloseNavigation: () => void;
  readonly onCompose: () => void;
  readonly session: MailWorkspaceViewProps["session"];
  readonly settings: MailWorkspaceViewProps["settings"];
}

export const MailSidebarView = ({
  account,
  branding,
  folders,
  isComposerReady,
  isMobileOpen,
  mailboxManagement,
  labelManagement,
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
        <span className="block truncate text-xs text-indigo-100/90">
          {account.email}
        </span>
        <span className="mt-0.5 block truncate text-[10px] uppercase tracking-[0.08em] text-indigo-100/80">
          {account.provider}
        </span>
      </span>
    </div>

    <button
      aria-busy={!isComposerReady}
      className="mx-4 mt-4 flex h-12 items-center justify-center gap-2 rounded-2xl bg-[var(--brand-accent)] px-4 text-sm font-bold text-[var(--brand-accent-foreground)] shadow-lg transition hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-70 disabled:hover:translate-y-0"
      disabled={!isComposerReady}
      onClick={onCompose}
      title={isComposerReady ? undefined : "Loading account settings"}
      type="button"
    >
      <PenLine aria-hidden size={18} />
      New message
    </button>

    <nav aria-label="Mail folders" className="mt-6 min-h-0 flex-1 overflow-y-auto px-3">
      <div className="mb-2 flex items-center justify-between px-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-indigo-100/80">
          Mailboxes
        </p>
        <button
          aria-label="Create mailbox"
          className="grid size-8 place-items-center rounded-lg text-indigo-100/80 hover:bg-white/10 hover:text-white"
          onClick={() => mailboxManagement.openCreate()}
          title="Create mailbox"
          type="button"
        >
          <Plus aria-hidden size={17} />
        </button>
      </div>
      <div className="space-y-1">
        {folders.map((folder) => (
          <div className="group relative" key={folder.id}>
            <button
              className={`flex h-11 w-full items-center gap-3 rounded-xl pr-3 text-sm transition ${
                folder.isActive
                  ? "bg-white/12 font-semibold text-white"
                  : "text-indigo-100/90 hover:bg-white/6 hover:text-white"
              } ${folder.canManage ? "pr-11" : ""}`}
              onClick={folder.onSelect}
              style={{ paddingLeft: `${12 + Math.min(folder.depth, 6) * 14}px` }}
              type="button"
            >
              <span
                className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/6"
                style={{ color: folder.color }}
              >
                <MailboxIconView icon={folder.icon} />
              </span>
              <span className="min-w-0 flex-1 truncate text-left">{folder.label}</span>
              {folder.count > 0 ? (
                <span className="rounded-full bg-white/8 px-2 py-0.5 text-[11px] tabular-nums text-indigo-100/90">
                  {folder.count}
                </span>
              ) : null}
            </button>
            {folder.canManage ? (
              <button
                aria-label={`Manage ${folder.label}`}
                className="absolute right-1.5 top-1.5 grid size-8 place-items-center rounded-lg text-indigo-100/70 opacity-100 hover:bg-white/10 hover:text-white md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                onClick={folder.onManage}
                title={`Manage ${folder.label}`}
                type="button"
              >
                <MoreHorizontal aria-hidden size={17} />
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {labelManagement.isSupported ? (
        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between px-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-indigo-100/80">
              Labels
            </p>
            <button
              aria-label="Create label"
              className="grid size-8 place-items-center rounded-lg text-indigo-100/80 hover:bg-white/10 hover:text-white"
              onClick={labelManagement.openCreate}
              title="Create label"
              type="button"
            >
              <Plus aria-hidden size={17} />
            </button>
          </div>
          <div className="space-y-1">
            {labelManagement.labels.map((label) => (
              <div className="group relative flex h-10 items-center gap-3 rounded-xl px-3 pr-11 text-sm text-indigo-100/90" key={label.id}>
                <span
                  aria-hidden
                  className="size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: label.color }}
                />
                <span className="min-w-0 flex-1 truncate">
                  {label.name}
                  {labelManagement.deletingLabelIds.has(label.id) ? (
                    <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-200">
                      deleting
                    </span>
                  ) : null}
                </span>
                <button
                  aria-label={`Manage ${label.name} label`}
                  className="absolute right-1.5 top-1 grid size-8 place-items-center rounded-lg text-indigo-100/70 opacity-100 hover:bg-white/10 hover:text-white md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                  onClick={() => labelManagement.openEdit(label.id)}
                  title={`Manage ${label.name} label`}
                  type="button"
                >
                  {labelManagement.deletingLabelIds.has(label.id)
                    ? <LoaderCircle aria-hidden className="animate-spin" size={16} />
                    : <MoreHorizontal aria-hidden size={17} />}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </nav>

    <div className="m-4">
      <button
        className="flex h-11 w-full items-center gap-3 rounded-xl px-3 text-sm text-indigo-100/90 transition hover:bg-white/7 hover:text-white"
        onClick={settings.open}
        type="button"
      >
        <Settings aria-hidden size={18} />
        Profile &amp; security
      </button>
      {session.canSignOut ? (
        <button
          aria-busy={session.isSigningOut}
          className="flex h-11 w-full items-center gap-3 rounded-xl px-3 text-sm text-indigo-100/90 transition hover:bg-white/7 hover:text-white"
          disabled={session.isSigningOut}
          onClick={session.onSignOut}
          type="button"
        >
          <LogOut aria-hidden size={18} />
          {session.isSigningOut ? "Signing out…" : "Sign out"}
        </button>
      ) : null}
      {branding.publicRepositoryUrl ? (
        <a className="mt-2 block px-3 text-[10px] font-semibold text-indigo-100/80 hover:text-white" href={branding.publicRepositoryUrl} rel="noreferrer" target="_blank">
          Open-source code
        </a>
      ) : null}
    </div>
  </aside>
);
