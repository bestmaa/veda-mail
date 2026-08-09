import { Bookmark, Keyboard, Menu, RefreshCw, Search, Settings, Trash2, X } from "lucide-react";

import type { MailWorkspaceViewProps } from "@/presentation/features/mail-workspace/mail-workspace.view-model";
import { BrandMarkView } from "@/presentation/shared/branding/ui/brand-mark.view";

type MailHeaderViewProps = Pick<
  MailWorkspaceViewProps,
  | "account"
  | "branding"
  | "keyboardShortcuts"
  | "navigation"
  | "onRefresh"
  | "onSearchClear"
  | "onSearchSubmit"
  | "search"
  | "searchInput"
  | "searchMaxLength"
  | "searchValue"
  | "settings"
>;

export const MailHeaderView = ({
  account,
  branding,
  keyboardShortcuts,
  navigation,
  onRefresh,
  onSearchClear,
  onSearchSubmit,
  search,
  searchInput,
  searchMaxLength,
  searchValue,
  settings,
}: MailHeaderViewProps) => (
  <header className="flex h-[72px] items-center gap-4 border-b border-slate-200/80 bg-white px-4 md:px-5">
    <div className="flex w-auto items-center gap-3 md:w-[216px]">
      <button
        aria-label="Open navigation"
        className="grid size-10 place-items-center rounded-xl text-slate-500 hover:bg-slate-100 md:hidden"
        onClick={navigation.onOpen}
        type="button"
      >
        <Menu aria-hidden size={21} />
      </button>
      <BrandMarkView branding={branding} size="sm" />
      <div>
        <p className="text-[17px] font-extrabold tracking-[-0.03em] text-[#1e214d]">
          {branding.productName}
        </p>
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">
          private workspace
        </p>
      </div>
    </div>

    <form
      className="mx-auto flex h-11 w-full max-w-xl items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 transition focus-within:border-indigo-300 focus-within:bg-white focus-within:shadow-sm"
      onSubmit={onSearchSubmit}
    >
      <Search aria-hidden className="shrink-0 text-slate-500" size={18} />
      <input
        aria-describedby={search.error ? "mail-search-error" : undefined}
        aria-label="Search mail"
        aria-keyshortcuts={keyboardShortcuts.enabled ? "/" : undefined}
        className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-500"
        list="mail-search-suggestions"
        maxLength={searchMaxLength}
        onChange={searchInput}
        placeholder="Search mail, people, or attachments"
        data-mail-search
        role="searchbox"
        type="search"
        value={searchValue}
      />
      <datalist id="mail-search-suggestions">
        {search.suggestions.map((suggestion) => (
          <option key={suggestion} value={suggestion} />
        ))}
      </datalist>
      {searchValue ? (
        <button
          aria-label="Clear search"
          className="grid size-7 place-items-center rounded-lg text-slate-600 hover:bg-slate-200 hover:text-slate-800"
          onClick={onSearchClear}
          type="button"
        >
          <X aria-hidden size={15} />
        </button>
      ) : null}
    </form>

    <details className="group relative">
      <summary
        aria-label="Manage saved searches"
        className="grid size-10 cursor-pointer list-none place-items-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 [&::-webkit-details-marker]:hidden"
        title="Saved searches"
      >
        <Bookmark aria-hidden size={18} />
      </summary>
      <div className="absolute right-0 top-12 z-50 w-80 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
        <h2 className="text-sm font-extrabold text-slate-900">Saved searches</h2>
        <p className="mt-1 text-xs leading-5 text-slate-600">
          Save the active search, then replay it on this mail account.
        </p>
        <div className="mt-3 flex gap-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Saved search name</span>
            <input
              className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              disabled={search.saved.isSaving}
              maxLength={80}
              onChange={(event) => search.saved.onNameChange(event.target.value)}
              placeholder="Name this search"
              type="text"
              value={search.saved.name}
            />
          </label>
          <button
            className="h-10 rounded-xl bg-indigo-600 px-3 text-xs font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!search.saved.canSave}
            onClick={search.saved.onSave}
            type="button"
          >
            Save
          </button>
        </div>
        {search.saved.error ? <p className="mt-2 text-xs font-semibold text-red-700" role="alert">{search.saved.error}</p> : null}
        {search.saved.isLoading ? <p className="mt-3 text-xs text-slate-600" role="status">Loading saved searches…</p> : null}
        {!search.saved.isLoading && search.saved.items.length === 0 ? (
          <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">No saved searches yet.</p>
        ) : null}
        {search.saved.items.length ? (
          <ul aria-label="Saved searches" className="mt-3 max-h-64 space-y-1 overflow-y-auto">
            {search.saved.items.map((item) => (
              <li className="flex items-center gap-1" key={item.id}>
                <button
                  className="min-w-0 flex-1 rounded-xl px-3 py-2 text-left hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-indigo-600"
                  onClick={item.onApply}
                  title={item.query}
                  type="button"
                >
                  <span className="block truncate text-sm font-bold text-slate-800">{item.name}</span>
                  <span className="block truncate text-xs text-slate-500">{item.query}</span>
                </button>
                <button
                  aria-label={`Delete saved search ${item.name}`}
                  className="grid size-9 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-700"
                  disabled={search.saved.isSaving}
                  onClick={item.onDelete}
                  type="button"
                >
                  <Trash2 aria-hidden size={15} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>

    <div className="flex items-center gap-1.5">
      <button
        aria-keyshortcuts={keyboardShortcuts.enabled ? "?" : undefined}
        aria-label="Open keyboard shortcut guide"
        className="grid size-10 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
        data-keyboard-shortcuts-trigger
        onClick={keyboardShortcuts.onOpen}
        title="Keyboard shortcuts"
        type="button"
      >
        <Keyboard aria-hidden size={18} />
      </button>
      <button
        aria-label="Refresh mail"
        className="grid size-10 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
        onClick={onRefresh}
        type="button"
      >
        <RefreshCw aria-hidden size={18} />
      </button>
      <button
        aria-label={`Open account settings for ${account.email}`}
        className="group ml-1 grid size-10 place-items-center rounded-xl bg-[#e8e8ff] text-xs font-extrabold text-[#4f46a5] transition hover:bg-indigo-200"
        onClick={settings.open}
        type="button"
        title={`${account.name} · ${account.provider}`}
      >
        <span className="group-hover:hidden">{account.avatar}</span>
        <Settings aria-hidden className="hidden group-hover:block" size={17} />
      </button>
    </div>
  </header>
);
