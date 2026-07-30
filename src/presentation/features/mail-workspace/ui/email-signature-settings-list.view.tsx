import { FileSignature, Plus } from "lucide-react";

import type { EmailSignatureSettingsViewModel } from "@/presentation/features/mail-workspace/email-signature-settings.view-model";

export const EmailSignatureSettingsListView = ({
  settings,
}: {
  readonly settings: EmailSignatureSettingsViewModel;
}) => (
  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
    <div className="mb-3 flex items-center justify-between gap-2">
      <div>
        <h4 className="text-sm font-bold text-slate-900">Saved signatures</h4>
        <p className="text-[11px] text-slate-600">
          {settings.items.length} of {settings.maximumSignatures}
        </p>
      </div>
      <button
        aria-label="Create signature"
        className="grid size-10 place-items-center rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!settings.canCreate}
        id="email-signature-create"
        onClick={settings.create}
        type="button"
      >
        <Plus aria-hidden size={18} />
      </button>
    </div>
    {settings.items.length ? (
      <ul aria-label="Saved signatures" className="space-y-1">
        {settings.items.map((item) => (
          <li key={item.id}>
            <button
              aria-current={item.isSelected ? "true" : undefined}
              className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-semibold ${
                item.isSelected
                  ? "bg-indigo-100 text-indigo-950"
                  : "text-slate-700 hover:bg-white"
              }`}
              disabled={settings.isSaving}
              id={`email-signature-item-${item.id}`}
              onClick={item.onSelect}
              type="button"
            >
              <FileSignature aria-hidden className="shrink-0" size={16} />
              <span className="truncate">{item.name}</span>
            </button>
          </li>
        ))}
      </ul>
    ) : settings.isLoading ? (
      <p className="py-8 text-center text-xs text-slate-600" role="status">
        Loading signatures…
      </p>
    ) : (
      <div className="px-2 py-8 text-center">
        <FileSignature
          aria-hidden
          className="mx-auto mb-2 text-slate-400"
          size={24}
        />
        <p className="text-sm font-semibold text-slate-700">
          No signatures yet
        </p>
        <p className="mt-1 text-xs text-slate-600">
          Create one, then choose when it is inserted.
        </p>
      </div>
    )}
  </div>
);
