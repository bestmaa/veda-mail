import "server-only";

import { AttachmentDownloadError } from "@/domain/mail/attachment-download-error";

export const ATTACHMENT_IMPORT_TIMEOUT_MS = 5 * 60 * 1_000;

const aborted = (): AttachmentDownloadError =>
  new AttachmentDownloadError(
    "aborted",
    "The attachment import was cancelled.",
  );

const providerFailure = (): AttachmentDownloadError =>
  new AttachmentDownloadError(
    "provider_failure",
    "The mail provider returned invalid attachment bytes.",
  );

const tooLarge = (): AttachmentDownloadError =>
  new AttachmentDownloadError(
    "size_limit_exceeded",
    "The attachment exceeds the forwarding size limit.",
  );

export interface AttachmentImportDeadline {
  dispose(): void;
  readonly signal: AbortSignal;
  timedOut(): boolean;
}

export const createAttachmentImportDeadline = (
  source: AbortSignal | undefined,
  timeoutMs = ATTACHMENT_IMPORT_TIMEOUT_MS,
): AttachmentImportDeadline => {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new RangeError("Attachment import timeout is invalid.");
  }
  const controller = new AbortController();
  let expired = false;
  const onAbort = (): void => controller.abort();
  source?.addEventListener("abort", onAbort, { once: true });
  if (source?.aborted) onAbort();
  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
  }, timeoutMs);
  timer.unref();
  return {
    dispose: () => {
      clearTimeout(timer);
      source?.removeEventListener("abort", onAbort);
    },
    signal: controller.signal,
    timedOut: () => expired,
  };
};

export const waitForAttachmentImport = <T>(
  operation: Promise<T>,
  signal: AbortSignal,
  onLateValue?: (value: T) => void,
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    let settled = false;
    const settle = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = (): void => settle(() => reject(aborted()));
    signal.addEventListener("abort", onAbort, { once: true });
    void operation.then(
      (value) => {
        if (settled) {
          try {
            onLateValue?.(value);
          } catch {
            // Cleanup of a provider-controlled late value is best-effort.
          }
          return;
        }
        settle(() => resolve(value));
      },
      (error: unknown) => settle(() => reject(error)),
    );
    if (signal.aborted) onAbort();
  });

export interface CollectedAttachmentBody {
  readonly body: AsyncIterable<Uint8Array>;
  dispose(): void;
  readonly size: number;
}

const QUARANTINE_CHUNK_BYTES = 64 * 1_024;
const MAX_SOURCE_PULLS = 65_536;

export const collectAttachmentBody = async (
  body: ReadableStream<Uint8Array>,
  expectedBytes: number | null,
  maximumBytes: number,
  signal: AbortSignal,
): Promise<CollectedAttachmentBody> => {
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = body.getReader();
  } catch {
    throw providerFailure();
  }
  let complete = false;
  let pulls = 0;
  let total = 0;
  const content = new Uint8Array(maximumBytes);
  const wipe = (): void => {
    content.fill(0);
  };
  const cancel = (): void => {
    void reader.cancel(aborted()).catch(() => undefined);
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      const result = await waitForAttachmentImport(reader.read(), signal);
      if (result.done) {
        complete = true;
        if (total < 1 || (expectedBytes !== null && total !== expectedBytes)) {
          throw providerFailure();
        }
        return {
          body: {
            async *[Symbol.asyncIterator]() {
              for (
                let offset = 0;
                offset < total;
                offset += QUARANTINE_CHUNK_BYTES
              ) {
                yield content.subarray(
                  offset,
                  Math.min(total, offset + QUARANTINE_CHUNK_BYTES),
                );
              }
            },
          },
          dispose: wipe,
          size: total,
        };
      }
      pulls += 1;
      if (pulls > MAX_SOURCE_PULLS) throw providerFailure();
      if (!(result.value instanceof Uint8Array)) throw providerFailure();
      if (result.value.byteLength > maximumBytes - total) throw tooLarge();
      if (result.value.byteLength === 0) continue;
      content.set(result.value, total);
      total += result.value.byteLength;
    }
  } catch (error) {
    wipe();
    if (error instanceof AttachmentDownloadError) throw error;
    throw providerFailure();
  } finally {
    signal.removeEventListener("abort", cancel);
    if (!complete) {
      void reader.cancel().catch(() => undefined);
    }
    try {
      reader.releaseLock();
    } catch {
      // A provider-controlled pending read releases the lock after cancellation.
    }
  }
};
