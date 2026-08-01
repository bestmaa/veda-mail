import { LoaderCircle, X } from "lucide-react";

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
            Add a private color label without changing where mail is stored.
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
          disabled={management.isSaving}
          maxLength={100}
          onChange={(event) => management.onNameChange(event.target.value)}
          required
          value={management.name}
        />
      </label>

      <fieldset className="mt-5" disabled={management.isSaving}>
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

      <div className="mt-6 flex justify-end gap-2">
        <button
          className="h-11 rounded-xl px-4 text-sm font-semibold text-slate-600 hover:bg-slate-100"
          disabled={management.isSaving}
          onClick={management.onClose}
          type="button"
        >
          Cancel
        </button>
        <button
          className="flex h-11 min-w-24 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-60"
          disabled={management.isSaving || management.name.trim().length === 0}
          type="submit"
        >
          {management.isSaving ? <LoaderCircle aria-hidden className="animate-spin" size={17} /> : null}
          {management.mode === "create" ? "Create" : "Save"}
        </button>
      </div>
    </form>
  </div>
) : null;
