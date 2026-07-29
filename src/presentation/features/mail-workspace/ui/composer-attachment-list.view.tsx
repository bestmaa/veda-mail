import { FileText, LoaderCircle, X } from "lucide-react";

import type { ComposerAttachmentViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";

export const ComposerAttachmentListView = ({
  attachments,
  isSending,
}: {
  readonly attachments: readonly ComposerAttachmentViewModel[];
  readonly isSending: boolean;
}) =>
  attachments.length > 0 ? (
    <ul
      aria-label="Message attachments"
      className="mx-3 mb-2 grid max-h-32 gap-1 overflow-y-auto"
    >
      {attachments.map((attachment) => (
        <li
          className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
          key={attachment.id}
        >
          {attachment.state === "uploading" ? (
            <LoaderCircle
              aria-hidden
              className="shrink-0 animate-spin text-indigo-600"
              size={17}
            />
          ) : (
            <FileText
              aria-hidden
              className="shrink-0 text-slate-500"
              size={17}
            />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-bold text-slate-800">
              {attachment.name}
            </span>
            <span
              className={`block text-[11px] ${
                attachment.error ? "text-red-700" : "text-slate-500"
              }`}
            >
              {attachment.error ?? attachment.meta}
            </span>
            <span
              aria-atomic="true"
              className="sr-only"
              role={attachment.state === "error" ? "alert" : "status"}
            >
              {attachment.state === "ready"
                ? `${attachment.name} is ready to send.`
                : attachment.state === "error"
                  ? `${attachment.name} upload failed: ${
                      attachment.error ?? "Attachment upload failed."
                    }`
                  : `${attachment.name} is uploading and being scanned.`}
            </span>
          </span>
          <button
            aria-label={`Remove ${attachment.name}`}
            className="grid size-7 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-700"
            disabled={isSending}
            onClick={attachment.onRemove}
            type="button"
          >
            <X aria-hidden size={15} />
          </button>
        </li>
      ))}
    </ul>
  ) : null;
