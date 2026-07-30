import { Download, Paperclip } from "lucide-react";

import type { AttachmentViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";
import { AttachmentCardView } from "@/presentation/features/mail-workspace/ui/attachment-card.view";

export const ReceivedAttachmentListView = ({
  attachments,
  downloadAll,
}: {
  readonly attachments: readonly AttachmentViewModel[];
  readonly downloadAll: {
    readonly isPreparing: boolean;
    readonly onClick: () => void;
  } | null;
}) =>
  attachments.length > 0 ? (
    <section
      aria-labelledby="received-attachments-title"
      className="border-t border-slate-100 pt-5"
    >
      <div className="mb-3 flex min-h-11 flex-wrap items-center justify-between gap-2">
        <h3
          className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-600"
          id="received-attachments-title"
        >
          <Paperclip aria-hidden size={14} />
          Attachments
        </h3>
        {attachments.length >= 2 && downloadAll ? (
          <button
            aria-label={`Download all ${attachments.length} attachments as a ZIP file`}
            className="flex h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-bold text-indigo-700 transition hover:border-indigo-200 hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-wait disabled:opacity-60"
            disabled={downloadAll.isPreparing}
            onClick={downloadAll.onClick}
            type="button"
          >
            <Download aria-hidden size={16} />
            {downloadAll.isPreparing ? "Preparing ZIP…" : "Download all"}
          </button>
        ) : null}
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {attachments.map((attachment) => (
          <li className="min-w-0" key={attachment.id}>
            <AttachmentCardView attachment={attachment} />
          </li>
        ))}
      </ul>
    </section>
  ) : null;
