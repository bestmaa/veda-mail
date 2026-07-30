import "server-only";

import { AttachmentDownloadError } from "@/domain/mail/attachment-download-error";
import type {
  AttachmentDownload,
  AttachmentDownloadInput,
} from "@/domain/mail/mail";
import {
  normalizeReceivedAttachmentMimeType,
  sanitizeReceivedAttachmentName,
} from "@/domain/mail/received-attachment";
import type { AttachmentId, MessageId } from "@/domain/shared/brand";
import { waitForAttachmentImport } from "@/server/mail/attachment-import-operation";

interface AttachmentImportSourceInput {
  readonly attachmentId: AttachmentId;
  readonly download: (
    input: AttachmentDownloadInput,
  ) => Promise<AttachmentDownload>;
  readonly maximumBytes: number;
  readonly messageId: MessageId;
  readonly signal: AbortSignal;
}

export const attachmentImportProviderFailure = (): AttachmentDownloadError =>
  new AttachmentDownloadError(
    "provider_failure",
    "The mail provider returned an invalid attachment.",
  );

const attachmentImportAborted = (): AttachmentDownloadError =>
  new AttachmentDownloadError(
    "aborted",
    "The attachment import was cancelled.",
  );

const cancelLateAttachmentDownload = (download: AttachmentDownload): void => {
  try {
    const body = download?.body;
    if (typeof body?.cancel !== "function") return;
    void body.cancel(attachmentImportAborted()).catch(() => undefined);
  } catch {
    // Provider cancellation is best-effort and must not mask the abort.
  }
};

export const fetchAttachmentImportSource = async (
  input: AttachmentImportSourceInput,
): Promise<AttachmentDownload> => {
  try {
    if (input.signal.aborted) throw attachmentImportAborted();
    const download = await waitForAttachmentImport(
      input.download({
        attachmentId: input.attachmentId,
        maxBytes: input.maximumBytes,
        messageId: input.messageId,
        signal: input.signal,
      }),
      input.signal,
      cancelLateAttachmentDownload,
    );
    let body: ReadableStream<Uint8Array>;
    try {
      const candidate = download?.body;
      if (
        !download ||
        typeof download !== "object" ||
        typeof candidate?.getReader !== "function"
      ) {
        throw attachmentImportProviderFailure();
      }
      body = candidate;
    } catch {
      throw attachmentImportProviderFailure();
    }
    try {
      const size = download.size;
      if (
        size !== null &&
        (!Number.isSafeInteger(size) || size < 0)
      ) {
        throw attachmentImportProviderFailure();
      }
      if (size !== null && size > input.maximumBytes) {
        throw new AttachmentDownloadError(
          "size_limit_exceeded",
          "The attachment exceeds the forwarding size limit.",
        );
      }
      return {
        body,
        mimeType: normalizeReceivedAttachmentMimeType(download.mimeType),
        name: sanitizeReceivedAttachmentName(download.name),
        size,
      };
    } catch (error) {
      try {
        void body.cancel(error).catch(() => undefined);
      } catch {
        // Provider cancellation is best-effort and must not mask validation.
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof AttachmentDownloadError) throw error;
    throw attachmentImportProviderFailure();
  }
};
