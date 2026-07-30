import { Save, Trash2, Undo2 } from "lucide-react";

import {
  MAX_EMAIL_SIGNATURE_CONTENT_CHARACTERS,
  MAX_EMAIL_SIGNATURE_NAME_CHARACTERS,
} from "@/domain/member/email-signature";
import type { EmailSignatureEditorViewModel } from "@/presentation/features/mail-workspace/email-signature-settings.view-model";
import { ComposerRichTextEditorConnector } from "@/presentation/features/mail-workspace/connectors/composer-rich-text-editor.connector";

const modeButton = (selected: boolean): string =>
  `h-10 rounded-lg px-3 text-xs font-bold focus-visible:outline-2 focus-visible:outline-indigo-600 ${
    selected
      ? "bg-indigo-100 text-indigo-900"
      : "text-slate-600 hover:bg-slate-100"
  }`;

export const EmailSignatureEditorView = ({
  editor,
  isSaving,
}: {
  readonly editor: EmailSignatureEditorViewModel;
  readonly isSaving: boolean;
}) => (
  <form
    className="min-w-0 rounded-xl border border-slate-200 bg-white p-4"
    onSubmit={editor.onSubmit}
  >
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h4 className="text-sm font-bold text-slate-900">
          {editor.isNew ? "Create signature" : "Edit signature"}
        </h4>
        <p className="text-[11px] text-slate-600">
          Images, custom styles, and remote tracking content are removed.
        </p>
      </div>
      <div aria-label="Signature format" className="flex" role="group">
        <button
          aria-pressed={editor.mode === "plain"}
          className={modeButton(editor.mode === "plain")}
          disabled={isSaving}
          id="email-signature-mode-plain"
          onClick={editor.selectPlainMode}
          type="button"
        >
          Plain text
        </button>
        <button
          aria-pressed={editor.mode === "rich"}
          className={modeButton(editor.mode === "rich")}
          disabled={isSaving}
          onClick={editor.selectRichMode}
          type="button"
        >
          Rich text
        </button>
      </div>
    </div>
    <label className="block text-xs font-bold text-slate-700">
      Signature name
      <input
        autoComplete="off"
        className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
        disabled={isSaving}
        maxLength={MAX_EMAIL_SIGNATURE_NAME_CHARACTERS}
        onChange={editor.nameInput}
        placeholder="For example, Work"
        required
        value={editor.name}
      />
    </label>
    <div className="mt-4">
      {editor.mode === "plain" ? (
        <label className="block text-xs font-bold text-slate-700">
          Signature content
          <textarea
            className="mt-1.5 min-h-40 w-full resize-y rounded-xl border border-slate-200 p-3 text-sm leading-6 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
            disabled={isSaving}
            id="email-signature-plain-content"
            maxLength={MAX_EMAIL_SIGNATURE_CONTENT_CHARACTERS}
            onChange={editor.bodyInput}
            placeholder="Name, role, and contact details"
            required
            value={editor.body}
          />
        </label>
      ) : (
        <div
          aria-label="Rich signature editor"
          className="flex min-h-52 flex-col overflow-hidden rounded-xl border border-slate-200"
        >
          <ComposerRichTextEditorConnector
            autoFocus={false}
            disabled={isSaving}
            initialHtml={editor.htmlBody}
            key={editor.editorVersion}
            label="Signature content"
            namespace="VedaMailSignatureSettings"
            onChange={editor.onRichChange}
            placeholder="Name, role, and contact details"
            required
          />
        </div>
      )}
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {editor.canDelete ? (
        <button
          className="flex h-10 items-center gap-2 rounded-xl px-3 text-xs font-bold text-rose-700 hover:bg-rose-50"
          id="email-signature-delete"
          onClick={editor.onDelete}
          type="button"
        >
          <Trash2 aria-hidden size={15} />
          Delete
        </button>
      ) : null}
      <span className="flex-1" />
      <button
        className="flex h-10 items-center gap-2 rounded-xl px-3 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        disabled={!editor.canDiscard}
        onClick={editor.onDiscard}
        type="button"
      >
        <Undo2 aria-hidden size={15} />
        Discard changes
      </button>
      <button
        className="flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
        disabled={!editor.canSave}
        type="submit"
      >
        <Save aria-hidden size={15} />
        {isSaving ? "Saving…" : "Save signature"}
      </button>
    </div>
  </form>
);
