import type { ComposerViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";
import type { RecipientSuggestionFieldModel } from "@/presentation/features/mail-workspace/recipient-suggestions.view-model";

interface ComposerRecipientFieldViewProps {
  readonly autoFocus?: boolean;
  readonly bccExpanded?: boolean;
  readonly ccExpanded?: boolean;
  readonly disabled: boolean;
  readonly id: string;
  readonly label: string;
  readonly onChange: ComposerViewModel["toInput"];
  readonly onToggleBcc?: () => void;
  readonly onToggleCc?: () => void;
  readonly placeholder: string;
  readonly readOnly: boolean;
  readonly showRecipientControls?: boolean;
  readonly suggestions: RecipientSuggestionFieldModel;
  readonly value: string;
}

const kindLabel = {
  contact: "Contact",
  group: "Group",
  recent: "Recent",
} as const;

export const ComposerRecipientFieldView = ({
  autoFocus,
  bccExpanded,
  ccExpanded,
  disabled,
  id,
  label,
  onChange,
  onToggleBcc,
  onToggleCc,
  placeholder,
  readOnly,
  showRecipientControls,
  suggestions,
  value,
}: ComposerRecipientFieldViewProps) => (
  <div className="relative flex min-h-12 items-center border-b border-slate-100 px-4">
    <label className="w-14 text-xs font-semibold text-slate-600" htmlFor={id}>
      {label}
    </label>
    <input
      aria-activedescendant={suggestions.activeDescendant}
      aria-autocomplete="list"
      aria-controls={suggestions.isOpen ? suggestions.listboxId : undefined}
      aria-expanded={suggestions.isOpen}
      autoComplete="off"
      autoFocus={autoFocus}
      className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none focus-visible:outline-2 focus-visible:outline-indigo-600"
      disabled={disabled}
      id={id}
      onBlur={suggestions.onBlur}
      onChange={(event) => {
        onChange(event);
        suggestions.onValueChange();
      }}
      onFocus={suggestions.onFocus}
      onKeyDown={suggestions.onKeyDown}
      placeholder={placeholder}
      readOnly={readOnly}
      role="combobox"
      type="text"
      value={value}
    />
    {showRecipientControls ? <>
      <button aria-controls="composer-cc-row" aria-expanded={ccExpanded} className="ml-2 rounded-lg px-2 py-1 text-xs font-bold text-slate-500 hover:bg-indigo-50 hover:text-indigo-700" disabled={disabled || readOnly} onClick={onToggleCc} type="button">Cc</button>
      <button aria-controls="composer-bcc-row" aria-expanded={bccExpanded} className="rounded-lg px-2 py-1 text-xs font-bold text-slate-500 hover:bg-indigo-50 hover:text-indigo-700" disabled={disabled || readOnly} onClick={onToggleBcc} type="button">Bcc</button>
    </> : null}
    {suggestions.isOpen ? (
      <div
        aria-label={`${label} recipient suggestions`}
        className="absolute left-14 right-3 top-[calc(100%-2px)] z-50 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl"
        id={suggestions.listboxId}
        role="listbox"
      >
        {suggestions.suggestions.map((suggestion, index) => {
          const optionId = `${suggestions.listboxId}-${index}`;
          return (
            <button
              aria-selected={suggestions.activeDescendant === optionId}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-indigo-50 aria-selected:bg-indigo-100"
              id={optionId}
              key={suggestion.id}
              onClick={() => suggestions.onSelect(suggestion)}
              onMouseDown={(event) => event.preventDefault()}
              role="option"
              type="button"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-slate-800">
                  {suggestion.label}
                </span>
                <span className="block truncate text-xs text-slate-500">
                  {suggestion.description}
                </span>
              </span>
              <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                {kindLabel[suggestion.kind]}
              </span>
            </button>
          );
        })}
      </div>
    ) : null}
  </div>
);
