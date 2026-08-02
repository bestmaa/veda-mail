import { X } from "lucide-react";

import type { MailSearchViewModel } from "@/presentation/features/mail-workspace/mail-search.view-model";

interface MailSearchFiltersViewProps {
  readonly search: MailSearchViewModel;
}

export const MailSearchFiltersView = ({ search }: MailSearchFiltersViewProps) => {
  if (!search.error && !search.filters.length) return null;
  return (
    <div className="mt-3 space-y-2">
      {search.error ? (
        <p
          className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700"
          id="mail-search-error"
          role="alert"
        >
          {search.error}
        </p>
      ) : null}
      {search.filters.length ? (
        <aside aria-label="Active search filters" className="flex flex-wrap gap-2">
          {search.filters.map((filter) => (
            <button
              aria-label={`Remove search filter ${filter.label}`}
              className="flex min-h-8 items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-800 hover:bg-indigo-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
              key={filter.id}
              onClick={filter.onRemove}
              type="button"
            >
              <span className="max-w-56 truncate">{filter.label}</span>
              <X aria-hidden size={13} />
            </button>
          ))}
        </aside>
      ) : null}
    </div>
  );
};
