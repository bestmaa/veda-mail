import { Plus, Trash2, X } from "lucide-react";

import type { ContactManagementViewModel } from "@/presentation/features/mail-workspace/contact-management.view-model";

export const ContactEditorView = ({
  editor,
  isSaving,
}: {
  readonly editor: ContactManagementViewModel["contactEditor"];
  readonly isSaving: boolean;
}) => {
  if (!editor.isOpen) return null;
  return (
    <div aria-label={editor.title} aria-modal="true" className="absolute inset-4 z-20 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl" role="dialog">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-bold text-slate-900">{editor.title}</h3>
        <button aria-label="Close contact editor" className="grid size-9 place-items-center rounded-lg hover:bg-slate-100" disabled={isSaving} onClick={editor.onCancel} type="button">
          <X aria-hidden size={18} />
        </button>
      </div>
      <form className="mt-5 space-y-4" onSubmit={editor.onSubmit}>
        <label className="block text-sm font-semibold text-slate-700">
          Display name
          <input autoComplete="name" className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" disabled={isSaving} maxLength={160} onChange={editor.onNameInput} required type="text" value={editor.name} />
        </label>
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-slate-700">Email addresses</legend>
          {editor.emails.map((email, index) => (
            <div className="grid grid-cols-[minmax(0,1fr)_8rem_auto] gap-2" key={index}>
              <label className="sr-only" htmlFor={`contact-email-${index}`}>Email address {index + 1}</label>
              <input autoComplete="email" className="h-11 min-w-0 rounded-xl border border-slate-300 px-3 outline-none focus:border-indigo-500" disabled={isSaving} id={`contact-email-${index}`} maxLength={320} onChange={(event) => editor.updateEmail(index, "email", event.target.value)} placeholder="name@example.com" required type="email" value={email.email} />
              <label className="sr-only" htmlFor={`contact-label-${index}`}>Label {index + 1}</label>
              <input className="h-11 min-w-0 rounded-xl border border-slate-300 px-3 outline-none focus:border-indigo-500" disabled={isSaving} id={`contact-label-${index}`} maxLength={40} onChange={(event) => editor.updateEmail(index, "label", event.target.value)} placeholder="Work" type="text" value={email.label ?? ""} />
              <button aria-label={`Remove email ${index + 1}`} className="grid size-11 place-items-center rounded-xl text-rose-600 hover:bg-rose-50 disabled:opacity-40" disabled={isSaving || editor.emails.length === 1} onClick={() => editor.removeEmail(index)} type="button">
                <Trash2 aria-hidden size={17} />
              </button>
            </div>
          ))}
        </fieldset>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-40" disabled={isSaving || editor.emails.length >= 5} onClick={editor.addEmail} type="button">
            <Plus aria-hidden size={16} /> Add email
          </button>
          <div className="flex gap-2">
            <button className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold" disabled={isSaving} onClick={editor.onCancel} type="button">Cancel</button>
            <button className="rounded-xl bg-indigo-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50" disabled={isSaving} type="submit">{isSaving ? "Saving…" : "Save contact"}</button>
          </div>
        </div>
      </form>
    </div>
  );
};
