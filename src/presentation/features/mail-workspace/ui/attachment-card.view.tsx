import { Download, Eye, File, LoaderCircle } from "lucide-react";

import type { AttachmentViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";

export const AttachmentCardView = ({
  attachment,
  downloadButtonRef,
  onDownload,
}: {
  readonly attachment: AttachmentViewModel;
  readonly downloadButtonRef?: { current: HTMLButtonElement | null };
  readonly onDownload?: React.MouseEventHandler<HTMLButtonElement>;
}) => {
  const feedbackId = `attachment-${attachment.id}-download-feedback`;
  return (
    <div className="group grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 rounded-2xl border border-slate-200 p-3 text-left transition hover:border-indigo-200 hover:bg-indigo-50">
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
          aria-busy={attachment.isPreviewing}
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
        aria-busy={attachment.isDownloading}
        aria-describedby={
          attachment.isDownloading || attachment.error ? feedbackId : undefined
        }
        aria-label={`Download ${attachment.name}`}
        className="flex h-11 items-center gap-1 rounded-lg px-2 text-xs font-bold text-indigo-700 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-wait disabled:opacity-60"
        disabled={attachment.isDownloading}
        onClick={onDownload ?? attachment.onDownload}
        ref={downloadButtonRef}
        type="button"
      >
        {attachment.isDownloading ? (
          <LoaderCircle aria-hidden className="animate-spin" size={15} />
        ) : (
          <Download aria-hidden size={15} />
        )}
        Download
      </button>
    </span>
      {attachment.isDownloading ? (
        <p
          className="col-start-2 min-w-0 break-words text-xs text-slate-600 [overflow-wrap:anywhere]"
          id={feedbackId}
          role="status"
        >
          Scanning {attachment.name} before download…
        </p>
      ) : attachment.error ? (
        <p
          className="col-start-2 min-w-0 break-words text-xs font-semibold text-red-700 [overflow-wrap:anywhere]"
          id={feedbackId}
          role="alert"
        >
          {attachment.error}
        </p>
      ) : null}
    </div>
  );
};
