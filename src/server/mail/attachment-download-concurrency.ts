import "server-only";

import { AttachmentDownloadError } from "@/domain/mail/attachment-download-error";
import { ApiError } from "@/transport/http/api-error";

const MAX_ACTIVE_DOWNLOADS = 16;
const MAX_ACTIVE_DOWNLOADS_PER_SUBJECT = 3;

interface DownloadConcurrencyState {
  active: number;
  readonly subjects: Map<string, number>;
}

const globalState = globalThis as typeof globalThis & {
  __vedaMailAttachmentDownloadConcurrency?: DownloadConcurrencyState;
};

const state =
  globalState.__vedaMailAttachmentDownloadConcurrency ??
  { active: 0, subjects: new Map<string, number>() };
globalState.__vedaMailAttachmentDownloadConcurrency = state;

export interface AttachmentDownloadLease {
  release(): void;
}

const busy = (): never => {
  throw new ApiError(
    "Too many attachment downloads are active. Please try again shortly.",
    "ATTACHMENT_DOWNLOAD_BUSY",
    429,
  );
};

export const acquireAttachmentDownloadLease = (
  subject: string,
): AttachmentDownloadLease => {
  const current = state.subjects.get(subject) ?? 0;
  if (
    state.active >= MAX_ACTIVE_DOWNLOADS ||
    current >= MAX_ACTIVE_DOWNLOADS_PER_SUBJECT
  ) {
    busy();
  }
  state.active += 1;
  state.subjects.set(subject, current + 1);
  let released = false;
  return {
    release: () => {
      if (released) return;
      released = true;
      state.active = Math.max(0, state.active - 1);
      const remaining = Math.max(0, (state.subjects.get(subject) ?? 1) - 1);
      if (remaining === 0) state.subjects.delete(subject);
      else state.subjects.set(subject, remaining);
    },
  };
};

interface LeasedStreamOptions {
  readonly expectedBytes?: number;
  readonly lease: AttachmentDownloadLease;
  readonly maxBytes: number;
  readonly signal?: AbortSignal;
  readonly source: ReadableStream<Uint8Array>;
}

const downloadError = (
  code: "aborted" | "provider_failure" | "size_limit_exceeded",
  message: string,
): AttachmentDownloadError => new AttachmentDownloadError(code, message);

export const createLeasedAttachmentDownloadStream = (
  options: LeasedStreamOptions,
): ReadableStream<Uint8Array> => {
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = options.source.getReader();
  } catch (error) {
    options.lease.release();
    throw error;
  }
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let finished = false;
  let received = 0;

  const finalize = (): void => {
    if (finished) return;
    finished = true;
    options.signal?.removeEventListener("abort", onAbort);
    options.lease.release();
  };

  const fail = (error: AttachmentDownloadError): void => {
    if (finished) return;
    controller?.error(error);
    void reader.cancel(error).catch(() => undefined);
    finalize();
  };

  const onAbort = (): void =>
    fail(downloadError("aborted", "The attachment download was cancelled."));

  return new ReadableStream<Uint8Array>(
    {
      cancel: async (reason) => {
        finalize();
        try {
          await reader.cancel(reason);
        } catch {
          // Cancellation is best-effort after the concurrency slot is released.
        }
      },
      pull: async (streamController) => {
        try {
          const chunk = await reader.read();
          if (finished) return;
          if (chunk.done) {
            if (
              options.expectedBytes !== undefined &&
              received !== options.expectedBytes
            ) {
              fail(
                downloadError(
                  "provider_failure",
                  "The mail provider returned an incomplete attachment.",
                ),
              );
              return;
            }
            streamController.close();
            finalize();
            return;
          }
          if (!(chunk.value instanceof Uint8Array)) {
            fail(
              downloadError(
                "provider_failure",
                "The mail provider returned invalid attachment bytes.",
              ),
            );
            return;
          }
          received += chunk.value.byteLength;
          if (
            received > options.maxBytes ||
            (options.expectedBytes !== undefined &&
              received > options.expectedBytes)
          ) {
            fail(
              downloadError(
                received > options.maxBytes
                  ? "size_limit_exceeded"
                  : "provider_failure",
                "The attachment stream exceeded its declared byte limit.",
              ),
            );
            return;
          }
          streamController.enqueue(chunk.value);
        } catch (error) {
          if (finished) return;
          fail(
            error instanceof AttachmentDownloadError
              ? error
              : downloadError(
                  options.signal?.aborted ? "aborted" : "provider_failure",
                  "The attachment stream could not be completed.",
                ),
          );
        }
      },
      start: (streamController) => {
        controller = streamController;
        if (options.signal?.aborted) onAbort();
        else options.signal?.addEventListener("abort", onAbort, { once: true });
      },
    },
    { highWaterMark: 0 },
  );
};
