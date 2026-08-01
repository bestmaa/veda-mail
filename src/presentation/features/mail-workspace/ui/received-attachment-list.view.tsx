import { Download, Paperclip } from "lucide-react";

import type { AttachmentViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";
import { AttachmentCardConnector } from "@/presentation/features/mail-workspace/connectors/attachment-card.connector";

export const ReceivedAttachmentListView = ({
  attachments,
  downloadAll,
  downloadAllButtonRef,
}: {
  readonly attachments: readonly AttachmentViewModel[];
  readonly downloadAll: {
    readonly error: string | null;
    readonly isPreparing: boolean;
    readonly onClick: () => void;
  } | null;
  readonly downloadAllButtonRef?: React.Ref<HTMLButtonElement>;
}) => {
  const archiveFeedbackId = "received-attachments-archive-feedback";
  return attachments.length > 0 ? (
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
            aria-busy={downloadAll.isPreparing}
            aria-describedby={
              downloadAll.isPreparing || downloadAll.error
                ? archiveFeedbackId
                : undefined
            }
            aria-label={`Download all ${attachments.length} attachments as a ZIP file`}
            className="flex h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-bold text-indigo-700 transition hover:border-indigo-200 hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-wait disabled:opacity-60"
            disabled={downloadAll.isPreparing}
            onClick={downloadAll.onClick}
            ref={downloadAllButtonRef}
            type="button"
          >
            <Download aria-hidden size={16} />
            Download all
          </button>
        ) : null}
      </div>
      {downloadAll?.isPreparing ? (
        <p
          className="mb-3 text-xs text-slate-600"
          id={archiveFeedbackId}
          role="status"
        >
          Scanning and preparing all attachments before download…
        </p>
      ) : downloadAll?.error ? (
        <p
          className="mb-3 text-xs font-semibold text-red-700"
          id={archiveFeedbackId}
          role="alert"
        >
          {downloadAll.error}
        </p>
      ) : null}
      <ul className="grid gap-2 sm:grid-cols-2">
        {attachments.map((attachment) => (
          <li className="min-w-0" key={attachment.id}>
            <AttachmentCardConnector attachment={attachment} />
          </li>
        ))}
      </ul>
    </section>
  ) : null;
};
