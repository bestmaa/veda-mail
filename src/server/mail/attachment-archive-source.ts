import "server-only";

import { AttachmentDownloadError } from "@/domain/mail/attachment-download-error";

export interface AttachmentArchiveSource {
  readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  cancel(reason: unknown): void;
  release(): void;
}

const archiveError = (
  code: "aborted" | "provider_failure" | "timeout",
  message: string,
): AttachmentDownloadError => new AttachmentDownloadError(code, message);

export const attachmentArchiveAbortError = (
  signal: AbortSignal,
): AttachmentDownloadError => {
  const reason = signal.reason as { readonly name?: unknown } | undefined;
  return reason?.name === "TimeoutError"
    ? archiveError("timeout", "The attachment archive timed out.")
    : archiveError("aborted", "The attachment archive was cancelled.");
};

export const normalizeAttachmentArchiveStreamError = (
  error: unknown,
  signal: AbortSignal,
): AttachmentDownloadError => {
  if (error instanceof AttachmentDownloadError) return error;
  if (signal.aborted) return attachmentArchiveAbortError(signal);
  return archiveError(
    "provider_failure",
    "The mail provider attachment stream failed.",
  );
};

export const ownAttachmentArchiveSource = (
  body: ReadableStream<Uint8Array>,
): AttachmentArchiveSource => {
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = body.getReader();
  } catch {
    throw archiveError(
      "provider_failure",
      "The mail provider returned an unusable attachment stream.",
    );
  }
  let settled = false;
  return {
    reader,
    cancel: (reason) => {
      if (settled) return;
      settled = true;
      void reader.cancel(reason).catch(() => undefined);
    },
    release: () => {
      if (settled) return;
      settled = true;
      reader.releaseLock();
    },
  };
};

export const readAttachmentArchiveSource = async (
  source: AttachmentArchiveSource,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> =>
  new Promise((resolve, reject) => {
    let settled = false;
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      const error = attachmentArchiveAbortError(signal);
      source.cancel(error);
      reject(error);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    source.reader.read().then(
      (result) => {
        signal.removeEventListener("abort", onAbort);
        if (settled) return;
        settled = true;
        resolve(result);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        if (settled) return;
        settled = true;
        reject(normalizeAttachmentArchiveStreamError(error, signal));
      },
    );
    if (signal.aborted) onAbort();
  });
