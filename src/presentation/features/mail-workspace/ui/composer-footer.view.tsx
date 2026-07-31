import { Paperclip, RefreshCw, Save, Send, Trash2 } from "lucide-react";

import type { ComposerViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";

const phaseLabel = {
  conflict: "Conflict",
  error: "Error",
  saved: "Saved",
  saving: "Saving",
  unsaved: "Unsaved",
} as const;

export const ComposerFooterView = ({
  composer,
}: {
  readonly composer: ComposerViewModel;
}) => (
  <>
    {composer.error ? (
      <p className="mx-4 mb-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700" role="alert">
        {composer.error}
      </p>
    ) : null}
    {composer.draft.error ? (
      <p className="mx-4 mb-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700" role="alert">
        {composer.draft.error}
      </p>
    ) : null}
    <div className="flex min-h-15 shrink-0 flex-wrap items-center gap-1 border-t border-slate-100 px-3 py-2">
      <button
        className="flex h-10 items-center gap-2 rounded-xl bg-[#ff785a] px-4 text-sm font-bold text-slate-950 transition hover:bg-[#ff6848] disabled:cursor-not-allowed disabled:opacity-60"
        disabled={composer.isBusy || !composer.draft.canSend || composer.isUploading || composer.attachments.some(({ state }) => state === "error")}
        type="submit"
      >
        <Send aria-hidden size={16} />
        {composer.isSending ? "Sending…" : "Send"}
      </button>
      <label
        aria-label={composer.maxAttachmentBytes > 0
          ? "Attach files"
          : composer.attachmentCapabilityUnavailable
            ? "Attachment limit could not be verified"
            : "Attachments are unavailable for this provider"}
        className={`grid size-9 place-items-center rounded-xl focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-indigo-600 ${
          composer.maxAttachmentBytes > 0 && !composer.isBusy && composer.draft.canEdit
            ? "cursor-pointer text-slate-600 hover:bg-indigo-50 hover:text-indigo-700"
            : "cursor-not-allowed text-slate-300"
        }`}
        htmlFor="composer-attachments"
      >
        <Paperclip aria-hidden size={18} />
        <input
          className="sr-only"
          disabled={composer.isBusy || !composer.draft.canEdit || composer.maxAttachmentBytes <= 0}
          id="composer-attachments"
          multiple
          onChange={composer.attachmentInput}
          type="file"
        />
      </label>
      {composer.attachmentCapabilityUnavailable ? (
        <button
          aria-label="Retry attachment check"
          className="grid size-9 place-items-center rounded-xl text-indigo-700 hover:bg-indigo-50 disabled:text-slate-400"
          disabled={composer.isAttachmentCapabilityRefreshing || composer.isBusy}
          onClick={composer.onRetryAttachmentCapability}
          type="button"
        >
          <RefreshCw aria-hidden className={composer.isAttachmentCapabilityRefreshing ? "animate-spin" : undefined} size={15} />
        </button>
      ) : null}
      {composer.draft.enabled ? (
        <>
          <button
            className="flex h-9 items-center gap-1.5 rounded-xl px-2 text-xs font-bold text-indigo-700 hover:bg-indigo-50 disabled:text-slate-400"
            disabled={composer.isBusy || !composer.draft.canSave}
            onClick={composer.draft.onSave}
            type="button"
          >
            <Save aria-hidden size={15} /> Save draft
          </button>
          <span aria-atomic="true" aria-live="polite" className="text-xs font-semibold text-slate-600" role="status">
            {phaseLabel[composer.draft.phase]}
          </span>
          {(composer.draft.requiresRecovery ||
            (composer.draft.phase === "error" &&
              (composer.draft.canSave || composer.draft.loadFailed))) ? (
            <button className="rounded-lg px-2 py-1 text-xs font-bold text-indigo-700 hover:bg-indigo-50 disabled:text-slate-400" disabled={composer.isBusy} onClick={composer.draft.onRetry} type="button">
              {composer.draft.requiresRecovery
                ? "Recover saved draft"
                : composer.draft.loadFailed ? "Retry loading draft" : "Retry save"}
            </button>
          ) : null}
          {composer.draft.phase === "conflict" && !composer.draft.requiresRecovery && composer.draft.onReload ? (
            <button className="rounded-lg px-2 py-1 text-xs font-bold text-indigo-700 hover:bg-indigo-50 disabled:text-slate-400" disabled={composer.isBusy} onClick={composer.draft.onReload} type="button">
              Reload saved draft
            </button>
          ) : null}
        </>
      ) : null}
      <span className="sr-only" role="status">
        {composer.isUploading ? "Preparing and scanning attachments" : ""}
      </span>
      {composer.draft.sendBlockedMessage ? (
        <span className="basis-full text-xs font-semibold text-amber-800" role="status">
          {composer.draft.sendBlockedMessage}
        </span>
      ) : null}
      <span className="flex-1" />
      <button
        aria-label="Discard draft"
        className="grid size-9 place-items-center rounded-xl text-slate-600 hover:bg-red-50 hover:text-red-700 disabled:text-slate-300"
        disabled={composer.isBusy || !composer.draft.canDiscard}
        id="composer-discard"
        onClick={composer.draft.onRequestDiscard}
        type="button"
      >
        <Trash2 aria-hidden size={17} />
      </button>
    </div>
  </>
);
