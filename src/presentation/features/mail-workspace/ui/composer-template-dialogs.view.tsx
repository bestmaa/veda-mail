import type { ComposerTemplateViewModel } from "@/presentation/features/mail-workspace/composer-template.view-model";

const DialogShell = ({
  children,
  description,
  destructive = false,
  dismissDisabled = false,
  onCancel,
  title,
}: {
  readonly children: React.ReactNode;
  readonly description: string;
  readonly destructive?: boolean;
  readonly dismissDisabled?: boolean;
  readonly onCancel: () => void;
  readonly title: string;
}) => {
  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-slate-950/30 p-4">
      <div aria-describedby="composer-template-dialog-description" aria-labelledby="composer-template-dialog-title" aria-modal="true" className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl outline-none focus-visible:outline-2 focus-visible:outline-indigo-600" onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        if (!dismissDisabled) onCancel();
      }} ref={(node) => { if (dismissDisabled) node?.focus(); }} role={destructive ? "alertdialog" : "dialog"} tabIndex={-1}>
        <h2 className="text-base font-bold text-slate-950" id="composer-template-dialog-title">{title}</h2>
        <p className="mt-2 text-sm text-slate-600" id="composer-template-dialog-description">{description}</p>
        {children}
      </div>
    </div>
  );
};

const actions = "mt-4 flex justify-end gap-2";
const cancel = "h-10 rounded-xl px-4 text-sm font-bold text-slate-700 hover:bg-slate-100";

export const ComposerTemplateDialogsView = ({ templates }: {
  readonly templates: ComposerTemplateViewModel;
}) => {
  if (templates.dialog === "save") return (
    <DialogShell description="Only the current subject and message body are stored. Recipients and attachments are never included." dismissDisabled={templates.isSaving} onCancel={templates.closeDialog} title="Save email template">
      <label className="mt-4 block text-xs font-bold text-slate-700" htmlFor="composer-template-name">Template name</label>
      <input className="mt-1 h-10 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus-visible:outline-2 focus-visible:outline-indigo-600 disabled:bg-slate-100 disabled:text-slate-500" disabled={templates.isSaving} id="composer-template-name" maxLength={80} onChange={templates.nameInput} value={templates.name} />
      {templates.error ? <p className="mt-2 text-xs font-semibold text-red-700" role="alert">{templates.error}</p> : null}
      <div className={actions}>
        <button className={cancel} disabled={templates.isSaving} onClick={templates.closeDialog} type="button">Cancel</button>
        <button className="h-10 rounded-xl bg-indigo-700 px-4 text-sm font-bold text-white disabled:opacity-50" disabled={templates.isSaving} onClick={templates.confirmSave} type="button">{templates.isSaving ? "Saving…" : "Save template"}</button>
      </div>
    </DialogShell>
  );
  if (templates.dialog === "replace") return (
    <DialogShell description="This removes the current subject, message text, and any quoted reply or forwarded text. Recipients, attachments, reply context, draft identity, and your managed signature are kept." destructive onCancel={templates.closeDialog} title="Replace current message?">
      <div className={actions}>
        <button className={cancel} id="composer-template-replace-cancel" onClick={templates.closeDialog} type="button">Cancel</button>
        <button className="h-10 rounded-xl bg-red-700 px-4 text-sm font-bold text-white" onClick={templates.confirmReplace} type="button">Replace message</button>
      </div>
    </DialogShell>
  );
  if (templates.dialog === "delete") return (
    <DialogShell description="The selected reusable template will be permanently removed. This does not change the current message." destructive dismissDisabled={templates.isSaving} onCancel={templates.closeDialog} title="Delete email template?">
      <div className={actions}>
        <button className={cancel} disabled={templates.isSaving} id="composer-template-delete-cancel" onClick={templates.closeDialog} type="button">Cancel</button>
        <button className="h-10 rounded-xl bg-red-700 px-4 text-sm font-bold text-white disabled:opacity-50" disabled={templates.isSaving} onClick={templates.confirmDelete} type="button">{templates.isSaving ? "Deleting…" : "Delete template"}</button>
      </div>
    </DialogShell>
  );
  return null;
};
