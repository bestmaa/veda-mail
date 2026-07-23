import { Menu, RefreshCw, Search, X } from "lucide-react";

import type { MailWorkspaceViewProps } from "@/presentation/features/mail-workspace/mail-workspace.view-model";
import { BrandMarkView } from "@/presentation/shared/branding/ui/brand-mark.view";

type MailHeaderViewProps = Pick<
  MailWorkspaceViewProps,
  | "account"
  | "branding"
  | "navigation"
  | "onRefresh"
  | "onSearchClear"
  | "onSearchSubmit"
  | "searchInput"
  | "searchValue"
>;

export const MailHeaderView = ({
  account,
  branding,
  navigation,
  onRefresh,
  onSearchClear,
  onSearchSubmit,
  searchInput,
  searchValue,
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
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
          private workspace
        </p>
      </div>
    </div>

    <form
      className="mx-auto flex h-11 w-full max-w-xl items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 transition focus-within:border-indigo-300 focus-within:bg-white focus-within:shadow-sm"
      onSubmit={onSearchSubmit}
    >
      <Search aria-hidden className="shrink-0 text-slate-400" size={18} />
      <input
        aria-label="Search mail"
        className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
        onChange={searchInput}
        placeholder="Search mail, people, or attachments"
        type="search"
        value={searchValue}
      />
      {searchValue ? (
        <button
          aria-label="Clear search"
          className="grid size-7 place-items-center rounded-lg text-slate-400 hover:bg-slate-200 hover:text-slate-700"
          onClick={onSearchClear}
          type="button"
        >
          <X aria-hidden size={15} />
        </button>
      ) : null}
    </form>

    <div className="flex items-center gap-1.5">
      <button
        aria-label="Refresh mail"
        className="grid size-10 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
        onClick={onRefresh}
        type="button"
      >
        <RefreshCw aria-hidden size={18} />
      </button>
      <span
        aria-label={`Account: ${account.email}`}
        className="ml-1 grid size-9 place-items-center rounded-xl bg-[#e8e8ff] text-xs font-extrabold text-[#4f46a5]"
        role="img"
        title={`${account.name} · ${account.provider}`}
      >
        {account.avatar}
      </span>
    </div>
  </header>
);
