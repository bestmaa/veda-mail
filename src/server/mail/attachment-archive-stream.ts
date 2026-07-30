import "server-only";

import {
  attachmentArchiveBytes,
  type AttachmentArchiveStreamOptions,
} from "@/server/mail/attachment-archive-generator";
import {
  attachmentArchiveAbortError,
  normalizeAttachmentArchiveStreamError,
  ownAttachmentArchiveSource,
} from "@/server/mail/attachment-archive-source";

export const createAttachmentArchiveStream = (
  options: AttachmentArchiveStreamOptions,
): ReadableStream<Uint8Array> => {
  const firstSource = ownAttachmentArchiveSource(options.firstDownload.body);
  const iterator = attachmentArchiveBytes({ ...options, firstSource });
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let finalized = false;
  const finalize = (): void => {
    if (finalized) return;
    finalized = true;
    options.signal.removeEventListener("abort", onAbort);
    options.onFinalize();
  };
  const onAbort = (): void => {
    if (finalized) return;
    const error = attachmentArchiveAbortError(options.signal);
    firstSource.cancel(error);
    controller?.error(error);
    void iterator.return(undefined).catch(() => undefined);
    finalize();
  };
  return new ReadableStream<Uint8Array>(
    {
      cancel: (reason) => {
        if (finalized) return;
        options.onCancel(reason);
        if (finalized) return;
        firstSource.cancel(reason);
        void iterator.return(undefined).catch(() => undefined);
        finalize();
      },
      pull: async (streamController) => {
        try {
          const next = await iterator.next();
          if (finalized) return;
          if (next.done) {
            streamController.close();
            finalize();
          } else {
            streamController.enqueue(next.value);
          }
        } catch (error) {
          if (finalized) return;
          const normalized = normalizeAttachmentArchiveStreamError(
            error,
            options.signal,
          );
          firstSource.cancel(normalized);
          streamController.error(normalized);
          options.onCancel(normalized);
          finalize();
        }
      },
      start: (streamController) => {
        controller = streamController;
        if (options.signal.aborted) onAbort();
        else options.signal.addEventListener("abort", onAbort, { once: true });
      },
    },
    { highWaterMark: 0 },
  );
};
