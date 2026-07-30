import "server-only";

import { AttachmentDownloadError } from "@/domain/mail/attachment-download-error";
import { waitForAttachmentImport } from "@/server/mail/attachment-import-operation";

const MAX_EMPTY_SOURCE_PULLS = 65_536;

const providerFailure = (): AttachmentDownloadError =>
  new AttachmentDownloadError(
    "provider_failure",
    "The mail provider returned invalid attachment bytes.",
  );

const tooLarge = (): AttachmentDownloadError =>
  new AttachmentDownloadError(
    "size_limit_exceeded",
    "The attachment exceeds the preview size limit.",
  );

export interface CollectedPreviewBody {
  readonly bytes: Uint8Array;
  dispose(): void;
}

export const collectAttachmentPreviewBody = async (
  body: ReadableStream<Uint8Array>,
  expectedBytes: number | null,
  maximumBytes: number,
  signal: AbortSignal,
): Promise<CollectedPreviewBody> => {
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = body.getReader();
  } catch {
    throw providerFailure();
  }
  const storage = new Uint8Array(maximumBytes);
  let complete = false;
  let emptyPulls = 0;
  let total = 0;
  const cancel = (): void => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      const result = await waitForAttachmentImport(reader.read(), signal);
      if (result.done) {
        complete = true;
        if (expectedBytes !== null && total !== expectedBytes) {
          throw providerFailure();
        }
        let disposed = false;
        return {
          bytes: storage.subarray(0, total),
          dispose: () => {
            if (disposed) return;
            disposed = true;
            storage.fill(0);
          },
        };
      }
      if (!(result.value instanceof Uint8Array)) throw providerFailure();
      if (result.value.byteLength > maximumBytes - total) throw tooLarge();
      if (result.value.byteLength === 0) {
        emptyPulls += 1;
        if (emptyPulls > MAX_EMPTY_SOURCE_PULLS) throw providerFailure();
        continue;
      }
      storage.set(result.value, total);
      total += result.value.byteLength;
    }
  } catch (error) {
    storage.fill(0);
    if (error instanceof AttachmentDownloadError) throw error;
    throw providerFailure();
  } finally {
    signal.removeEventListener("abort", cancel);
    if (!complete) cancel();
    try {
      reader.releaseLock();
    } catch {
      // A provider-controlled pending read releases after cancellation settles.
    }
  }
};
