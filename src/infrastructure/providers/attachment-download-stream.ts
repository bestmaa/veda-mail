import "server-only";

import { AttachmentDownloadError } from "@/domain/mail/attachment-download-error";

const FIRST_BYTE_TIMEOUT_MS = 20_000;
const IDLE_TIMEOUT_MS = 30_000;
const ABSOLUTE_TIMEOUT_MS = 5 * 60_000;

interface BoundedAttachmentStreamOptions {
  readonly errors?: {
    readonly aborted: () => Error;
    readonly providerFailure: () => Error;
    readonly sizeLimit: () => Error;
    readonly timeout: () => Error;
  };
  readonly expectedBytes?: number;
  readonly maxBytes: number;
  readonly onFinalize?: () => Promise<void> | void;
  readonly signal?: AbortSignal;
  readonly source: ReadableStream<Uint8Array>;
}

const cancelled = (): AttachmentDownloadError =>
  new AttachmentDownloadError(
    "aborted",
    "The attachment download was cancelled.",
  );

const timedOut = (): AttachmentDownloadError =>
  new AttachmentDownloadError(
    "timeout",
    "The mail provider attachment download timed out.",
  );

const providerFailure = (): AttachmentDownloadError =>
  new AttachmentDownloadError(
    "provider_failure",
    "The mail provider returned an incomplete attachment.",
  );

export const createBoundedAttachmentDownloadStream = (
  options: BoundedAttachmentStreamOptions,
): ReadableStream<Uint8Array> => {
  if (
    !Number.isSafeInteger(options.maxBytes) ||
    options.maxBytes <= 0 ||
    (options.expectedBytes !== undefined &&
      (!Number.isSafeInteger(options.expectedBytes) ||
        options.expectedBytes < 0))
  ) {
    throw new AttachmentDownloadError(
      "invalid_request",
      "Attachment download limits were invalid.",
    );
  }
  const errors = options.errors ?? {
    aborted: cancelled,
    providerFailure,
    sizeLimit: () =>
      new AttachmentDownloadError(
        "size_limit_exceeded",
        "The attachment exceeds the download size limit.",
      ),
    timeout: timedOut,
  };
  const reader = options.source.getReader();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let finalized = false;
  let total = 0;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let absoluteTimer: ReturnType<typeof setTimeout> | undefined;

  const finalize = (): void => {
    if (finalized) return;
    finalized = true;
    if (idleTimer) clearTimeout(idleTimer);
    if (absoluteTimer) clearTimeout(absoluteTimer);
    options.signal?.removeEventListener("abort", onAbort);
    void Promise.resolve(options.onFinalize?.()).catch(() => undefined);
  };

  const fail = (error: Error): void => {
    if (finalized) return;
    void reader.cancel(error).catch(() => undefined);
    controller?.error(error);
    finalize();
  };

  const armIdleTimeout = (duration: number): void => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => fail(errors.timeout()), duration);
  };

  const onAbort = (): void => fail(errors.aborted());

  return new ReadableStream<Uint8Array>(
    {
      cancel: async (reason) => {
        try {
          await reader.cancel(reason);
        } finally {
          finalize();
        }
      },
      pull: async (streamController) => {
        if (finalized) return;
        try {
          const chunk = await reader.read();
          if (chunk.done) {
            if (
              options.expectedBytes !== undefined &&
              total !== options.expectedBytes
            ) {
              fail(errors.providerFailure());
              return;
            }
            streamController.close();
            finalize();
            return;
          }
          if (!(chunk.value instanceof Uint8Array)) {
            fail(errors.providerFailure());
            return;
          }
          total += chunk.value.byteLength;
          if (
            total > options.maxBytes ||
            (options.expectedBytes !== undefined &&
              total > options.expectedBytes)
          ) {
            fail(
              total > options.maxBytes
                ? errors.sizeLimit()
                : errors.providerFailure(),
            );
            return;
          }
          armIdleTimeout(IDLE_TIMEOUT_MS);
          streamController.enqueue(chunk.value);
        } catch (error) {
          fail(
            error instanceof Error &&
              (error instanceof AttachmentDownloadError ||
                error.name.endsWith("AttachmentTransportError"))
              ? error
              : options.signal?.aborted
                ? errors.aborted()
                : errors.providerFailure(),
          );
        }
      },
      start: (streamController) => {
        controller = streamController;
        if (options.signal?.aborted) {
          fail(cancelled());
          return;
        }
        options.signal?.addEventListener("abort", onAbort, { once: true });
        armIdleTimeout(FIRST_BYTE_TIMEOUT_MS);
        absoluteTimer = setTimeout(
          () => fail(errors.timeout()),
          ABSOLUTE_TIMEOUT_MS,
        );
      },
    },
    { highWaterMark: 1 },
  );
};
