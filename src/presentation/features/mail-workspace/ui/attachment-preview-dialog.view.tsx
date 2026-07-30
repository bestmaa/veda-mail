import { FileText, LoaderCircle, X } from "lucide-react";

export const AttachmentPreviewDialogView = ({
  error,
  isLoading,
  isOpen,
  name,
  onClose,
  closeButtonRef,
  dialogRef,
  previewFrameRef,
  url,
}: {
  readonly closeButtonRef?: { current: HTMLButtonElement | null };
  readonly dialogRef?: { current: HTMLDialogElement | null };
  readonly error: string | null;
  readonly isLoading: boolean;
  readonly isOpen: boolean;
  readonly name: string;
  readonly onClose: () => void;
  readonly previewFrameRef?: { current: HTMLIFrameElement | null };
  readonly url: string | null;
}) => {
  if (!isOpen) return null;
  return (
    <dialog
      aria-labelledby="attachment-preview-title"
      aria-modal="true"
      className="m-auto max-h-[calc(100vh_-_1.5rem)] w-[calc(100vw_-_1.5rem)] max-w-4xl overflow-visible rounded-2xl bg-transparent p-0 shadow-2xl backdrop:bg-slate-950/55 md:max-h-[calc(100vh_-_4rem)] md:w-[calc(100vw_-_4rem)]"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      ref={dialogRef}
    >
      <section className="flex max-h-[inherit] w-full flex-col overflow-hidden rounded-2xl bg-white">
        <header className="flex min-h-14 items-center gap-3 border-b border-slate-200 px-4">
          <FileText aria-hidden className="text-indigo-700" size={18} />
          <h3
            className="min-w-0 flex-1 truncate text-sm font-extrabold text-slate-800"
            id="attachment-preview-title"
          >
            Preview: {name}
          </h3>
          <button
            aria-label="Close attachment preview"
            className="grid size-11 place-items-center rounded-xl text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
            onClick={onClose}
            ref={closeButtonRef}
            type="button"
          >
            <X aria-hidden size={18} />
          </button>
        </header>
        <div className="min-h-48 flex-1 overflow-auto bg-slate-50 p-4 md:p-6">
          {isLoading ? (
            <p
              className="flex items-center gap-2 text-sm font-semibold text-slate-600"
              role="status"
            >
              <LoaderCircle aria-hidden className="animate-spin" size={17} />
              Scanning and checking this attachment…
            </p>
          ) : null}
          {error ? (
            <p
              className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          {url ? (
            <iframe
              className="h-[60vh] min-h-64 w-full rounded-xl border border-slate-200 bg-white"
              ref={previewFrameRef}
              referrerPolicy="no-referrer"
              sandbox="allow-same-origin"
              src={url}
              title="Plain text attachment preview"
            />
          ) : null}
        </div>
      </section>
    </dialog>
  );
};
