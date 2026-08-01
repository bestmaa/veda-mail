import { LoaderCircle, Trash2, X } from "lucide-react";

import type { LabelManagementViewModel } from "@/presentation/features/mail-workspace/label-management.view-model";

export const LabelManagementView = ({
  management,
}: {
  readonly management: LabelManagementViewModel;
}) => management.isOpen ? (
  <div
    aria-labelledby="label-management-title"
    aria-modal="true"
    className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/55 p-4 backdrop-blur-sm"
    onKeyDown={management.onDialogKeyDown}
    role="dialog"
  >
    <form
      className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl"
      onSubmit={management.onSubmit}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-950" id="label-management-title">
            {management.title}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {management.isTargetDeleting
              ? "Removing this label from every matching message. This safely resumes if interrupted."
              : "Add a private color label without changing where mail is stored."}
          </p>
        </div>
        <button
          aria-label="Close label settings"
          className="grid size-10 place-items-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
          disabled={management.isSaving}
          onClick={management.onClose}
          type="button"
        >
          <X aria-hidden size={18} />
        </button>
      </div>

      <label className="mt-5 block text-sm font-semibold text-slate-700">
        Name
        <input
          autoComplete="off"
          autoFocus
          className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          disabled={management.isSaving || management.isConfirmingDelete || management.isTargetDeleting}
          maxLength={100}
          onChange={(event) => management.onNameChange(event.target.value)}
          required
          value={management.name}
        />
      </label>

      <fieldset className="mt-5" disabled={management.isSaving || management.isConfirmingDelete || management.isTargetDeleting}>
        <legend className="text-sm font-semibold text-slate-700">Color</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {management.colors.map((color) => (
            <label className="relative grid size-10 cursor-pointer place-items-center" key={color}>
              <input
                aria-label={`Use ${color}`}
                checked={management.color === color}
                className="peer absolute inset-0 z-10 size-full cursor-pointer appearance-none rounded-full opacity-0"
                name="label-color"
                onChange={() => management.onColorChange(color)}
                type="radio"
                value={color}
              />
              <span
                aria-hidden
                className="pointer-events-none size-7 rounded-full ring-offset-2 transition peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500 peer-checked:ring-2 peer-checked:ring-slate-900"
                style={{ backgroundColor: color }}
              />
            </label>
          ))}
        </div>
      </fieldset>

      {management.error ? (
        <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {management.error}
        </p>
      ) : null}

      {management.isTargetDeleting ? (
        <div className="mt-4 rounded-xl bg-amber-50 px-3 py-3 text-sm text-amber-800">
          <p role="status">Deletion is in progress. You can close this window; cleanup will resume when the mailbox is open.</p>
          <button
            className="mt-3 flex h-9 items-center gap-2 rounded-lg border border-amber-300 px-3 text-xs font-bold hover:bg-amber-100 disabled:opacity-60"
            disabled={management.isSaving}
            onClick={management.onDelete}
            type="button"
          >
            {management.isSaving ? <LoaderCircle aria-hidden className="animate-spin" size={15} /> : null}
            Continue cleanup
          </button>
        </div>
      ) : null}

      {management.isConfirmingDelete ? (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-semibold text-red-900">Delete this label?</p>
          <p className="mt-1 text-xs leading-5 text-red-700">
            Messages will stay in their mailboxes. Only this label will be removed, using a resumable verified cleanup.
          </p>
          <button
            className="mt-3 flex h-10 items-center gap-2 rounded-xl bg-red-600 px-4 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60"
            disabled={management.isSaving}
            onClick={management.onDelete}
            type="button"
          >
            {management.isSaving ? <LoaderCircle aria-hidden className="animate-spin" size={16} /> : <Trash2 aria-hidden size={16} />}
            Confirm delete
          </button>
        </div>
      ) : null}

      <div className="mt-6 flex items-center justify-between gap-2">
        {management.mode === "edit" && !management.isConfirmingDelete && !management.isTargetDeleting ? (
          <button
            className="flex h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-red-600 hover:bg-red-50"
            disabled={management.isSaving}
            onClick={management.requestDelete}
            type="button"
          >
            <Trash2 aria-hidden size={16} />
            Delete label
          </button>
        ) : <span />}
        <div className="flex justify-end gap-2">
          <button
            className="h-11 rounded-xl px-4 text-sm font-semibold text-slate-600 hover:bg-slate-100"
            disabled={management.isSaving}
            onClick={management.onClose}
            type="button"
          >
            {management.isTargetDeleting ? "Close" : "Cancel"}
          </button>
          <button
            className="flex h-11 min-w-24 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-60"
            disabled={management.isSaving || management.isConfirmingDelete || management.isTargetDeleting || management.name.trim().length === 0}
            type="submit"
          >
            {management.isSaving ? <LoaderCircle aria-hidden className="animate-spin" size={17} /> : null}
            {management.mode === "create" ? "Create" : "Save"}
          </button>
        </div>
      </div>
    </form>
  </div>
) : null;
