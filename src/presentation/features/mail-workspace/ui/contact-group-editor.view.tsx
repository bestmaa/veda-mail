import { X } from "lucide-react";

import type { ContactManagementViewModel } from "@/presentation/features/mail-workspace/contact-management.view-model";

export const ContactGroupEditorView = ({
  contacts,
  editor,
  isSaving,
}: {
  readonly contacts: NonNullable<ContactManagementViewModel["book"]>["contacts"];
  readonly editor: ContactManagementViewModel["groupEditor"];
  readonly isSaving: boolean;
}) => {
  if (!editor.isOpen) return null;
  return (
    <div aria-label={editor.title} aria-modal="true" className="absolute inset-4 z-20 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl" role="dialog">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-bold text-slate-900">{editor.title}</h3>
        <button aria-label="Close group editor" className="grid size-9 place-items-center rounded-lg hover:bg-slate-100" disabled={isSaving} onClick={editor.onCancel} type="button"><X aria-hidden size={18} /></button>
      </div>
      <form className="mt-5 space-y-4" onSubmit={editor.onSubmit}>
        <label className="block text-sm font-semibold text-slate-700">
          Group name
          <input className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" disabled={isSaving} maxLength={160} onChange={editor.onNameInput} required type="text" value={editor.name} />
        </label>
        <fieldset>
          <legend className="text-sm font-semibold text-slate-700">Members</legend>
          <div className="mt-2 max-h-72 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">
            {contacts.length ? contacts.map((contact) => (
              <label className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-slate-50" key={contact.id}>
                <input checked={editor.contactIds.includes(contact.id)} disabled={isSaving} onChange={() => editor.toggleContact(contact.id)} type="checkbox" />
                <span className="min-w-0"><span className="block truncate text-sm font-semibold">{contact.name}</span><span className="block truncate text-xs text-slate-500">{contact.emails[0]?.email}</span></span>
              </label>
            )) : <p className="p-3 text-sm text-slate-500">Create a contact before creating a group.</p>}
          </div>
        </fieldset>
        <div className="flex justify-end gap-2">
          <button className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold" disabled={isSaving} onClick={editor.onCancel} type="button">Cancel</button>
          <button className="rounded-xl bg-indigo-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50" disabled={isSaving || editor.contactIds.length === 0} type="submit">{isSaving ? "Saving…" : "Save group"}</button>
        </div>
      </form>
    </div>
  );
};
