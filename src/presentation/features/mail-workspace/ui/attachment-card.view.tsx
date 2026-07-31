import { Download, Eye, File, LoaderCircle } from "lucide-react";

import type { AttachmentViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";

export const AttachmentCardView = ({
  attachment,
}: {
  readonly attachment: AttachmentViewModel;
}) => (
  <div
    className="group grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 rounded-2xl border border-slate-200 p-3 text-left transition hover:border-indigo-200 hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
  >
    <span className="row-span-2 grid size-10 place-items-center rounded-xl bg-slate-100 text-slate-500">
      <File aria-hidden size={17} />
    </span>
    <span className="min-w-0">
      <span className="block truncate text-sm font-bold text-slate-700">
        {attachment.name}
      </span>
      <span className="block truncate text-xs text-slate-600">
        {attachment.meta}
      </span>
    </span>
    <span className="col-start-2 flex min-w-0 flex-wrap items-center gap-1">
      {attachment.onPreview ? (
        <button
          aria-label={`Preview ${attachment.name}`}
          className="flex h-11 items-center gap-1 rounded-lg px-2 text-xs font-bold text-indigo-700 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-wait disabled:opacity-60"
          disabled={attachment.isPreviewing}
          onClick={(event) => attachment.onPreview?.(event.currentTarget)}
          type="button"
        >
          {attachment.isPreviewing ? (
            <LoaderCircle aria-hidden className="animate-spin" size={15} />
          ) : (
            <Eye aria-hidden size={15} />
          )}
          {attachment.isPreviewing ? "Checking…" : "Preview"}
        </button>
      ) : null}
      <button
        aria-label={`Download ${attachment.name}`}
        className="flex h-11 items-center gap-1 rounded-lg px-2 text-xs font-bold text-indigo-700 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-wait disabled:opacity-60"
        disabled={attachment.isDownloading}
        onClick={attachment.onDownload}
        type="button"
      >
        {attachment.isDownloading ? (
          <LoaderCircle aria-hidden className="animate-spin" size={15} />
        ) : (
          <Download aria-hidden size={15} />
        )}
        {attachment.isDownloading ? "Downloading…" : "Download"}
      </button>
    </span>
  </div>
);
