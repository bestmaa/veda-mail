import "server-only";

import { AttachmentDownloadError } from "@/domain/mail/attachment-download-error";
import { createBoundedAttachmentDownloadStream } from "@/infrastructure/providers/attachment-download-stream";

export const throwIfMockAttachmentAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw new AttachmentDownloadError(
      "aborted",
      "The attachment download was cancelled.",
    );
  }
};

export const assertMockAttachmentDownloadInput = (
  maxBytes: number,
  signal?: AbortSignal,
): void => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new AttachmentDownloadError(
      "invalid_request",
      "Attachment byte limit must be a positive safe integer.",
    );
  }
  throwIfMockAttachmentAborted(signal);
};

const createByteSource = (
  content: Uint8Array,
): ReadableStream<Uint8Array> => {
  let delivered = false;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (delivered) {
        controller.close();
        return;
      }
      delivered = true;
      controller.enqueue(content);
    },
  });
};

export const createMockAttachmentStream = (
  content: Uint8Array,
  maxBytes: number,
  signal?: AbortSignal,
): ReadableStream<Uint8Array> =>
  createBoundedAttachmentDownloadStream({
    expectedBytes: content.byteLength,
    maxBytes,
    ...(signal ? { signal } : {}),
    source: createByteSource(content),
  });
