import type {
  EmailSignatureDefaultsViewModel,
  EmailSignatureSettingsListItem,
} from "@/presentation/features/mail-workspace/email-signature-settings.view-model";

const selectClass =
  "mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100";

export const EmailSignatureDefaultsView = ({
  defaults,
  isSaving,
  signatures,
}: {
  readonly defaults: EmailSignatureDefaultsViewModel;
  readonly isSaving: boolean;
  readonly signatures: readonly EmailSignatureSettingsListItem[];
}) => (
  <form
    className="rounded-xl border border-slate-200 bg-white p-4"
    onSubmit={defaults.onSubmit}
  >
    <h4 className="text-sm font-bold text-slate-900">Signature defaults</h4>
    <p className="mt-1 text-[11px] text-slate-600">
      Creating a signature does not enable it automatically.
    </p>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="text-xs font-bold text-slate-700">
        For new messages
        <select
          className={selectClass}
          disabled={isSaving}
          onChange={defaults.newMessageInput}
          value={defaults.newMessageId}
        >
          <option value="">No signature</option>
          {signatures.map(({ id, name }) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
      </label>
      <label className="text-xs font-bold text-slate-700">
        For replies and forwards
        <select
          className={selectClass}
          disabled={isSaving}
          onChange={defaults.replyForwardInput}
          value={defaults.replyForwardId}
        >
          <option value="">No signature</option>
          {signatures.map(({ id, name }) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
      </label>
    </div>
    <div className="mt-4 flex justify-end gap-2">
      <button
        className="h-10 rounded-xl px-3 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        disabled={!defaults.canDiscard}
        onClick={defaults.onDiscard}
        type="button"
      >
        Discard defaults
      </button>
      <button
        className="h-10 rounded-xl bg-slate-900 px-4 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-50"
        disabled={!defaults.canSave}
        type="submit"
      >
        Save defaults
      </button>
    </div>
  </form>
);
