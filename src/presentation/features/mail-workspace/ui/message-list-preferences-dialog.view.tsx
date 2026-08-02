import { LoaderCircle, X } from "lucide-react";

import {
  MESSAGE_LIST_DENSITIES,
  type UndoSendDelay,
  UNDO_SEND_DELAYS,
} from "@/domain/mail/message-list-preferences";
import type { MessageListPreferencesViewModel } from "@/presentation/features/mail-workspace/message-list-preferences.view-model";

const densityLabels = {
  compact: "Compact",
  comfortable: "Comfortable",
  spacious: "Spacious",
} as const;

export const MessageListPreferencesDialogView = ({
  dialog,
}: {
  readonly dialog: MessageListPreferencesViewModel["dialog"];
}) => dialog.isOpen ? (
  <div
    aria-labelledby="message-list-preferences-title"
    aria-modal="true"
    className="fixed inset-0 z-[90] grid place-items-center overflow-y-auto bg-slate-950/55 p-4 backdrop-blur-sm"
    id="message-list-preferences-dialog"
    role="dialog"
    tabIndex={-1}
  >
    <form
      className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl"
      onSubmit={dialog.onSubmit}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-950" id="message-list-preferences-title">
            Mailbox preferences
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            Choose how messages are displayed and sent for this account.
          </p>
        </div>
        <button
          aria-label="Close mailbox preferences"
          className="grid size-11 place-items-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
          disabled={dialog.isSaving}
          onClick={dialog.onClose}
          type="button"
        >
          <X aria-hidden size={18} />
        </button>
      </div>

      <fieldset className="mt-5" disabled={dialog.isSaving}>
        <legend className="text-sm font-semibold text-slate-700">Density</legend>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {MESSAGE_LIST_DENSITIES.map((density) => (
            <label className="cursor-pointer" key={density}>
              <input
                checked={dialog.density === density}
                className="peer sr-only"
                name="message-list-density"
                onChange={() => dialog.onDensityChange(density)}
                type="radio"
              />
              <span className="grid min-h-11 place-items-center rounded-xl border border-slate-300 px-2 text-sm font-semibold text-slate-600 peer-checked:border-indigo-500 peer-checked:bg-indigo-50 peer-checked:text-indigo-800 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-indigo-600">
                {densityLabels[density]}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="mt-5 block text-sm font-semibold text-slate-700">
        Sort order
        <select
          className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          disabled={dialog.isSaving}
          onChange={(event) => dialog.onSortChange(
            event.target.value === "oldest" ? "oldest" : "newest",
          )}
          value={dialog.sort}
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
      </label>

      <fieldset className="mt-6 border-t border-slate-200 pt-5" disabled={dialog.isSaving}>
        <legend className="px-1 text-sm font-semibold text-slate-700">Sending</legend>
        <label className="mt-2 block text-sm font-semibold text-slate-700">
          Undo send window
          <select
            className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            onChange={(event) => dialog.onUndoSendSecondsChange(
              Number(event.target.value) as UndoSendDelay,
            )}
            value={dialog.undoSendSeconds}
          >
            {UNDO_SEND_DELAYS.map((seconds) => (
              <option key={seconds} value={seconds}>
                {seconds === 0 ? "Off — send immediately" : `${seconds} seconds`}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-4 flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-700">
          <input
            checked={dialog.confirmBeforeSend}
            className="size-5 accent-indigo-600"
            onChange={(event) => dialog.onConfirmBeforeSendChange(event.target.checked)}
            type="checkbox"
          />
          Ask for confirmation before sending
        </label>
      </fieldset>

      <fieldset className="mt-6 border-t border-slate-200 pt-5" disabled={dialog.isSaving}>
        <legend className="px-1 text-sm font-semibold text-slate-700">
          Accessibility and keyboard
        </legend>
        <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-700">
          <input
            checked={dialog.keyboardShortcuts}
            className="size-5 accent-indigo-600"
            onChange={(event) => dialog.onKeyboardShortcutsChange(event.target.checked)}
            type="checkbox"
          />
          Enable single-key mailbox shortcuts
        </label>
        <p className="mt-2 text-xs leading-5 text-slate-500">
          Shortcuts never run while typing or while a dialog is open. Press ?
          for the shortcut guide.
        </p>
      </fieldset>

      <label className="mt-5 flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-700">
        <input
          checked={dialog.showPreview}
          className="size-5 accent-indigo-600"
          disabled={dialog.isSaving}
          onChange={(event) => dialog.onPreviewChange(event.target.checked)}
          type="checkbox"
        />
        Show message preview text
      </label>

      {dialog.error ? (
        <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {dialog.error}
        </p>
      ) : null}

      <div className="mt-6 flex justify-end gap-2">
        <button
          className="h-11 rounded-xl px-4 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          disabled={dialog.isSaving}
          onClick={dialog.onClose}
          type="button"
        >
          Cancel
        </button>
        <button
          className="flex h-11 min-w-24 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
          disabled={dialog.isSaving || !dialog.isDirty}
          type="submit"
        >
          {dialog.isSaving ? <LoaderCircle aria-hidden className="animate-spin" size={17} /> : null}
          Save
        </button>
      </div>
    </form>
  </div>
) : null;
