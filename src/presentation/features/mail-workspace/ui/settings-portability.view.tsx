import { Download, FileJson, Upload } from "lucide-react";

import type { SettingsPortabilityViewModel } from "@/presentation/features/mail-workspace/settings-portability.view-model";

export const SettingsPortabilityView = ({
  portability,
}: {
  readonly portability: SettingsPortabilityViewModel;
}) => (
  <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="mb-4 flex items-center gap-3">
      <FileJson aria-hidden className="text-indigo-600" size={20} />
      <div>
        <h3 className="font-bold text-slate-900">Settings portability</h3>
        <p className="text-xs text-slate-600">
          Transfer preferences and mail rules without provider-specific identifiers.
        </p>
      </div>
    </div>
    <p className="text-xs leading-5 text-slate-600">
      Exports a versioned JSON file. Mailbox moves use standard roles or folder
      paths, and labels use names so the file can move between providers.
    </p>
    <div className="mt-4 flex flex-wrap gap-2">
      <button
        className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        disabled={portability.isExporting || portability.isImporting}
        onClick={portability.onExport}
        type="button"
      >
        <Download aria-hidden size={16} />
        {portability.isExporting ? "Exporting…" : "Export settings"}
      </button>
      <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white hover:bg-indigo-700 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
        <Upload aria-hidden size={16} />
        Choose settings file
        <input
          accept=".json,application/json"
          className="sr-only"
          disabled={portability.isExporting || portability.isImporting}
          onChange={portability.onSelectFile}
          type="file"
        />
      </label>
    </div>
    {portability.pendingFileName ? (
      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
        <p className="text-xs font-semibold text-amber-900">
          Import {portability.pendingFileName}? Current preferences and rules
          will be replaced after all targets validate.
        </p>
        <div className="mt-3 flex gap-2">
          <button
            className="h-9 rounded-lg bg-amber-700 px-3 text-xs font-bold text-white hover:bg-amber-800 disabled:opacity-50"
            disabled={portability.isImporting}
            onClick={portability.confirmImport}
            type="button"
          >
            {portability.isImporting ? "Importing…" : "Replace and import"}
          </button>
          <button
            className="h-9 rounded-lg border border-amber-300 px-3 text-xs font-bold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
            disabled={portability.isImporting}
            onClick={portability.cancelImport}
            type="button"
          >
            Cancel
          </button>
        </div>
      </div>
    ) : null}
    {portability.error ? (
      <p className="mt-3 text-sm font-medium text-rose-600" role="alert">
        {portability.error}
      </p>
    ) : portability.success ? (
      <p className="mt-3 text-sm font-medium text-emerald-700" role="status">
        {portability.success}
      </p>
    ) : null}
  </section>
);
