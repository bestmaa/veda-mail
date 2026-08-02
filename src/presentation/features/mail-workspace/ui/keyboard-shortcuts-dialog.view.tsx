import { X } from "lucide-react";

import type { KeyboardShortcutsViewModel } from "@/presentation/features/mail-workspace/keyboard-shortcuts.view-model";

const shortcuts = [
  ["?", "Open this shortcut guide"],
  ["/", "Focus mail search"],
  ["C", "Compose a new message"],
  ["J / K", "Open the next / previous loaded message"],
  ["Esc", "Return to the message list"],
  ["E", "Archive the open message"],
  ["S", "Add or remove a star"],
  ["U", "Toggle read status"],
  ["R", "Reply"],
  ["A", "Reply all"],
  ["F", "Forward"],
] as const;

export const KeyboardShortcutsDialogView = ({
  dialog,
}: {
  readonly dialog: KeyboardShortcutsViewModel["dialog"];
}) => dialog.isOpen ? (
  <div
    aria-describedby="keyboard-shortcuts-description"
    aria-labelledby="keyboard-shortcuts-title"
    aria-modal="true"
    className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/55 p-4 backdrop-blur-sm"
    id="keyboard-shortcuts-dialog"
    role="dialog"
    tabIndex={-1}
  >
    <section className="max-h-[min(720px,90dvh)] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-950" id="keyboard-shortcuts-title">
            Keyboard shortcuts
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-600" id="keyboard-shortcuts-description">
            {dialog.enabled
              ? "Shortcuts are enabled for this account."
              : "Shortcuts are off. Enable them in Mailbox preferences."}
          </p>
        </div>
        <button
          aria-label="Close keyboard shortcut guide"
          className="grid size-11 place-items-center rounded-xl text-slate-500 hover:bg-slate-100"
          onClick={dialog.onClose}
          type="button"
        >
          <X aria-hidden size={18} />
        </button>
      </div>
      <dl className="mt-5 divide-y divide-slate-100">
        {shortcuts.map(([keys, description]) => (
          <div className="flex min-h-12 items-center justify-between gap-4 py-2" key={keys}>
            <dt className="text-sm text-slate-700">{description}</dt>
            <dd>
              <kbd className="rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1 font-mono text-xs font-bold text-slate-700 shadow-sm">
                {keys}
              </kbd>
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-5 rounded-xl bg-indigo-50 px-3 py-2 text-xs leading-5 text-indigo-800">
        Single-key shortcuts are suspended while you type, edit rich text, or
        use a dialog. Unavailable actions do nothing.
      </p>
    </section>
  </div>
) : null;
