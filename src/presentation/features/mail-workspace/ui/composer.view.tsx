import {
  Send,
  Trash2,
  X,
} from "lucide-react";

import type { ComposerViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";

export const ComposerView = ({ composer }: { readonly composer: ComposerViewModel }) =>
  composer.isOpen ? (
    <section
      aria-label="Compose message"
      aria-modal="true"
      className="fixed inset-x-3 bottom-3 z-40 flex max-h-[calc(100vh-24px)] flex-col overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-2xl shadow-slate-900/20 sm:inset-x-auto sm:right-5 sm:w-[560px]"
      role="dialog"
    >
      <div className="flex h-13 shrink-0 items-center gap-2 bg-[#292c68] px-4 text-white">
        <p className="flex-1 text-sm font-bold">New message</p>
        <button
          aria-label="Close composer"
          className="grid size-8 place-items-center rounded-lg text-indigo-100/70 hover:bg-white/10 hover:text-white"
          onClick={composer.onClose}
          type="button"
        >
          <X aria-hidden size={17} />
        </button>
      </div>

      <form className="flex min-h-0 flex-1 flex-col" onSubmit={composer.onSubmit}>
        <label className="flex min-h-12 items-center border-b border-slate-100 px-4">
          <span className="w-14 text-xs font-semibold text-slate-400">To</span>
          <input
            autoComplete="email"
            className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none"
            onChange={composer.toInput}
            placeholder="name@example.com"
            required
            type="text"
            value={composer.to}
          />
        </label>
        <label className="flex min-h-12 items-center border-b border-slate-100 px-4">
          <span className="w-14 text-xs font-semibold text-slate-400">
            Subject
          </span>
          <input
            className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-800 outline-none"
            onChange={composer.subjectInput}
            placeholder="What is this about?"
            type="text"
            value={composer.subject}
          />
        </label>
        <textarea
          aria-label="Message body"
          className="min-h-56 flex-1 resize-none px-4 py-4 text-sm leading-6 text-slate-700 outline-none placeholder:text-slate-300"
          onChange={composer.bodyInput}
          placeholder="Write a clear message…"
          required
          value={composer.body}
        />
        {composer.error ? (
          <p
            className="mx-4 mb-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700"
            role="alert"
          >
            {composer.error}
          </p>
        ) : null}
        <div className="flex h-15 shrink-0 items-center gap-1 border-t border-slate-100 px-3">
          <button
            aria-live="polite"
            className="flex h-10 items-center gap-2 rounded-xl bg-[#ff785a] px-4 text-sm font-bold text-white transition hover:bg-[#ff6848] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={composer.isSending}
            type="submit"
          >
            <Send aria-hidden size={16} />
            {composer.isSending ? "Sending…" : "Send"}
          </button>
          <span className="flex-1" />
          <button
            aria-label="Discard draft"
            className="grid size-9 place-items-center rounded-xl text-slate-400 hover:bg-red-50 hover:text-red-600"
            onClick={composer.onClose}
            type="button"
          >
            <Trash2 aria-hidden size={17} />
          </button>
        </div>
      </form>
    </section>
  ) : null;
