import { FileUp } from "lucide-react";

import type { MailImportViewModel } from "@/presentation/features/mail-workspace/mail-import.view-model";

export const MailImportView = ({ mailImport }: { readonly mailImport: MailImportViewModel }) => (
  <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="mb-4 flex items-center gap-3">
      <FileUp aria-hidden className="text-indigo-600" size={20} />
      <div>
        <h3 className="font-bold text-slate-900">Import mail</h3>
        <p className="text-xs text-slate-600">Add up to 20 standard RFC 5322 .eml files.</p>
      </div>
    </div>
    <label className="block text-xs font-bold text-slate-600">
      Destination mailbox
      <select
        className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
        disabled={mailImport.isImporting || !mailImport.mailboxes.length}
        onChange={mailImport.mailboxInput}
        value={mailImport.mailboxId}
      >
        {mailImport.mailboxes.map((mailbox) => (
          <option key={mailbox.id} value={mailbox.id}>{mailbox.label}</option>
        ))}
      </select>
    </label>
    <label className="mt-3 inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white hover:bg-indigo-700 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
      <FileUp aria-hidden size={16} />
      {mailImport.isImporting
        ? `Importing ${mailImport.imported} of ${mailImport.total}…`
        : "Choose .eml files"}
      <input
        accept=".eml,message/rfc822"
        className="sr-only"
        disabled={mailImport.isImporting || !mailImport.mailboxId}
        multiple
        onChange={mailImport.onFiles}
        type="file"
      />
    </label>
    {mailImport.error ? (
      <p className="mt-3 text-sm font-medium text-rose-600" role="alert">{mailImport.error}</p>
    ) : mailImport.success ? (
      <p className="mt-3 text-sm font-medium text-emerald-700" role="status">{mailImport.success}</p>
    ) : null}
  </section>
);
