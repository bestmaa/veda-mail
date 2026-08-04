import { Download, Pencil, Plus, Trash2, Upload, Users, X } from "lucide-react";

import type { ContactManagementViewModel } from "@/presentation/features/mail-workspace/contact-management.view-model";
import { ContactEditorView } from "@/presentation/features/mail-workspace/ui/contact-editor.view";
import { ContactGroupEditorView } from "@/presentation/features/mail-workspace/ui/contact-group-editor.view";

const tabs = [
  ["contacts", "Contacts"],
  ["groups", "Groups"],
  ["recents", "Recents"],
] as const;

export const ContactManagementView = ({
  management,
}: {
  readonly management: ContactManagementViewModel;
}) => {
  if (!management.isOpen) return null;
  const book = management.book;
  const editorOpen = management.contactEditor.isOpen || management.groupEditor.isOpen;
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/45 p-3 backdrop-blur-[1px]">
      <section aria-label="Contacts" aria-modal="true" className="relative flex max-h-[min(90dvh,780px)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl" role="dialog">
        <div {...(editorOpen || management.deleteConfirmation.isOpen ? { "aria-hidden": true, inert: true } : {})} className="flex min-h-0 flex-1 flex-col">
          <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-5 py-4">
            <span className="grid size-10 place-items-center rounded-xl bg-indigo-100 text-indigo-700"><Users aria-hidden size={20} /></span>
            <div className="min-w-0 flex-1"><h2 className="text-lg font-bold text-slate-900">Contacts</h2><p className="text-xs text-slate-500">Private address book for this mailbox</p></div>
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-50">
              <Upload aria-hidden size={16} />{management.transfer.isImporting ? "Importing…" : "Import vCard"}
              <input accept=".vcf,text/vcard,text/x-vcard" className="sr-only" disabled={management.transfer.isImporting || management.transfer.isExporting} onChange={management.transfer.onImportFile} type="file" />
            </label>
            <button className="flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50" disabled={management.transfer.isImporting || management.transfer.isExporting} onClick={management.transfer.onExport} type="button"><Download aria-hidden size={16} />{management.transfer.isExporting ? "Exporting…" : "Export"}</button>
            <button aria-label="Close contacts" className="grid size-10 place-items-center rounded-xl hover:bg-slate-100" disabled={management.isSaving} onClick={management.close} type="button"><X aria-hidden size={19} /></button>
          </header>
          <div className="flex gap-1 border-b border-slate-200 px-5 pt-3" role="tablist">
            {tabs.map(([value, label]) => (
              <button aria-selected={management.section === value} className="rounded-t-xl border-b-2 border-transparent px-4 py-2 text-sm font-semibold text-slate-600 aria-selected:border-indigo-600 aria-selected:text-indigo-700" key={value} onClick={() => management.selectSection(value)} role="tab" type="button">{label}</button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {management.error || management.transfer.error ? (
              <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><span>{management.transfer.error ?? management.error}</span><button className="font-bold underline" onClick={management.retry} type="button">Retry</button></div>
            ) : null}
            {management.hasConflict ? <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Contacts changed in another tab. The latest version has been loaded.</p> : null}
            {management.isLoading ? <p className="py-12 text-center text-sm text-slate-500">Loading contacts…</p> : null}
            {!management.isLoading && management.section === "contacts" ? <>
              <div className="mb-4 flex items-center justify-between"><p className="text-sm text-slate-500">{book?.contacts.length ?? 0} contacts</p><button className="flex items-center gap-2 rounded-xl bg-indigo-700 px-3 py-2 text-sm font-bold text-white" onClick={management.onCreateContact} type="button"><Plus aria-hidden size={16} />New contact</button></div>
              <div className="space-y-2">{book?.contacts.length ? book.contacts.map((contact) => (
                <article className="flex items-center gap-3 rounded-2xl border border-slate-200 p-3" key={contact.id}>
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-indigo-100 font-bold text-indigo-700">{contact.name.slice(0, 1).toUpperCase()}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{contact.name}</span><span className="block truncate text-xs text-slate-500">{contact.emails.map(({ email }) => email).join(", ")}</span></span>
                  <button aria-label={`Edit ${contact.name}`} className="grid size-9 place-items-center rounded-lg hover:bg-slate-100" onClick={() => management.onEditContact(contact)} type="button"><Pencil aria-hidden size={16} /></button>
                  <button aria-label={`Delete ${contact.name}`} className="grid size-9 place-items-center rounded-lg text-rose-600 hover:bg-rose-50" onClick={() => management.onDeleteContact(contact)} type="button"><Trash2 aria-hidden size={16} /></button>
                </article>
              )) : <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">No saved contacts yet.</p>}</div>
            </> : null}
            {!management.isLoading && management.section === "groups" ? <>
              <div className="mb-4 flex items-center justify-between"><p className="text-sm text-slate-500">{book?.groups.length ?? 0} groups</p><button className="flex items-center gap-2 rounded-xl bg-indigo-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50" disabled={!book?.contacts.length} onClick={management.onCreateGroup} type="button"><Plus aria-hidden size={16} />New group</button></div>
              <div className="space-y-2">{book?.groups.length ? book.groups.map((group) => (
                <article className="flex items-center gap-3 rounded-2xl border border-slate-200 p-3" key={group.id}><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{group.name}</span><span className="text-xs text-slate-500">{group.contactIds.length} member{group.contactIds.length === 1 ? "" : "s"}</span></span><button aria-label={`Edit ${group.name}`} className="grid size-9 place-items-center rounded-lg hover:bg-slate-100" onClick={() => management.onEditGroup(group)} type="button"><Pencil aria-hidden size={16} /></button><button aria-label={`Delete ${group.name}`} className="grid size-9 place-items-center rounded-lg text-rose-600 hover:bg-rose-50" onClick={() => management.onDeleteGroup(group)} type="button"><Trash2 aria-hidden size={16} /></button></article>
              )) : <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">No contact groups yet.</p>}</div>
            </> : null}
            {!management.isLoading && management.section === "recents" ? <>
              <div className="mb-4 flex items-center justify-between"><p className="text-sm text-slate-500">Recipients are recorded only after confirmed delivery.</p><button className="rounded-xl border border-rose-200 px-3 py-2 text-sm font-bold text-rose-700 disabled:opacity-40" disabled={!book?.recents.length} onClick={management.onClearRecents} type="button">Clear recents</button></div>
              <div className="space-y-2">{book?.recents.length ? book.recents.map((recent) => <article className="rounded-2xl border border-slate-200 p-3" key={recent.email.toLowerCase()}><span className="block text-sm font-bold">{recent.name ?? recent.email}</span><span className="block text-xs text-slate-500">{recent.email} · used {recent.useCount} time{recent.useCount === 1 ? "" : "s"}</span></article>) : <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">No confirmed recent recipients yet.</p>}</div>
            </> : null}
          </div>
        </div>
        <ContactEditorView editor={management.contactEditor} isSaving={management.isSaving} />
        <ContactGroupEditorView contacts={book?.contacts ?? []} editor={management.groupEditor} isSaving={management.isSaving} />
        {management.deleteConfirmation.isOpen ? <div className="absolute inset-0 z-30 grid place-items-center bg-slate-950/30 p-4"><section aria-label="Confirm contact deletion" aria-modal="true" className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl" role="dialog"><h3 className="font-bold text-slate-900">Confirm change</h3><p className="mt-2 text-sm text-slate-600">{management.deleteConfirmation.description}</p><div className="mt-5 flex justify-end gap-2"><button className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold" disabled={management.isSaving} onClick={management.deleteConfirmation.onCancel} type="button">Cancel</button><button className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50" disabled={management.isSaving} onClick={management.deleteConfirmation.onConfirm} type="button">{management.isSaving ? "Working…" : "Confirm"}</button></div></section></div> : null}
      </section>
    </div>
  );
};
