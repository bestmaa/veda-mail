import type { ComposerLinkEditorProps } from "@/presentation/features/mail-workspace/composer-rich-text.view-model";

export const ComposerLinkEditorView = ({
  disabled,
  error,
  inputRef,
  onApply,
  onCancel,
  onInput,
  onKeyDown,
  onRemove,
  value,
}: ComposerLinkEditorProps) => (
  <div
    aria-label="Insert link"
    className="border-b border-indigo-100 bg-indigo-50 px-3 py-2"
    onKeyDown={onKeyDown}
    role="dialog"
  >
    <div className="flex flex-wrap items-end gap-2">
      <label className="min-w-48 flex-1 text-xs font-semibold text-slate-700">
        Link address
        <input
          aria-describedby={error ? "composer-link-error" : undefined}
          autoFocus
          className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal outline-none focus-visible:border-indigo-600 focus-visible:ring-2 focus-visible:ring-indigo-200"
          disabled={disabled}
          onChange={onInput}
          placeholder="https://example.com"
          ref={inputRef}
          type="url"
          value={value}
        />
      </label>
      <button
        className="h-10 rounded-lg bg-indigo-700 px-3 text-xs font-bold text-white hover:bg-indigo-800"
        disabled={disabled}
        onClick={onApply}
        type="button"
      >
        Apply
      </button>
      <button
        className="h-10 rounded-lg px-3 text-xs font-bold text-slate-700 hover:bg-white"
        disabled={disabled}
        onClick={onRemove}
        type="button"
      >
        Remove
      </button>
      <button
        className="h-10 rounded-lg px-3 text-xs font-bold text-slate-700 hover:bg-white"
        disabled={disabled}
        onClick={onCancel}
        type="button"
      >
        Cancel
      </button>
    </div>
    {error ? (
      <p className="mt-1 text-xs font-semibold text-red-700" id="composer-link-error" role="alert">
        {error}
      </p>
    ) : null}
  </div>
);
