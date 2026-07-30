import "server-only";

import { AttachmentDownloadError } from "@/domain/mail/attachment-download-error";
import type {
  AttachmentDownload,
  AttachmentDownloadInput,
} from "@/domain/mail/mail";
import { MAX_RECEIVED_ATTACHMENT_TEXT_PREVIEW_BYTES } from "@/domain/mail/received-attachment";
import type { AttachmentId, MessageId } from "@/domain/shared/brand";
import type {
  AttachmentMimeDetector,
  AttachmentScanner,
} from "@/server/attachments";
import {
  acquireAttachmentPreviewLease,
  type AttachmentPreviewLease,
} from "@/server/mail/attachment-preview-concurrency";
import { collectAttachmentPreviewBody } from "@/server/mail/attachment-preview-body";
import { inspectTextAttachmentPreview } from "@/server/mail/attachment-preview-text";
import {
  acquireAttachmentDownloadLease,
  type AttachmentDownloadLease,
} from "@/server/mail/attachment-download-concurrency";
import { asAttachmentDownloadApiError } from "@/server/mail/attachment-download-http";
import { fetchAttachmentImportSource } from "@/server/mail/attachment-import-source";
import { createAttachmentImportDeadline } from "@/server/mail/attachment-import-operation";
import { ApiError } from "@/transport/http/api-error";

export const ATTACHMENT_PREVIEW_TIMEOUT_MS = 90 * 1_000;

interface AttachmentPreviewInput {
  readonly attachmentId: AttachmentId;
  readonly messageId: MessageId;
  readonly signal?: AbortSignal;
  readonly subject: string;
}

export interface AttachmentPreviewDependencies {
  readonly download: (
    input: AttachmentDownloadInput,
  ) => Promise<AttachmentDownload>;
  readonly mimeDetector: AttachmentMimeDetector;
  readonly scanner: AttachmentScanner;
  readonly timeoutMs?: number;
}

export interface PreparedAttachmentPreview {
  readonly bytes: Uint8Array;
  dispose(): void;
}

const mapFailure = (
  error: unknown,
  timedOut: boolean,
  requestAborted: boolean,
): unknown => {
  if (timedOut) {
    return new ApiError(
      "The attachment preview took too long to prepare.",
      "ATTACHMENT_PREVIEW_TIMEOUT",
      504,
    );
  }
  if (requestAborted) {
    return new ApiError(
      "The attachment preview was cancelled.",
      "ATTACHMENT_PREVIEW_ABORTED",
      499,
    );
  }
  if (
    error instanceof AttachmentDownloadError &&
    error.code === "size_limit_exceeded"
  ) {
    return new ApiError(
      "This attachment is too large to preview. You can still download it.",
      "ATTACHMENT_PREVIEW_TOO_LARGE",
      413,
    );
  }
  return error instanceof AttachmentDownloadError
    ? asAttachmentDownloadApiError(error)
    : error;
};

export const prepareTextAttachmentPreview = async (
  input: AttachmentPreviewInput,
  dependencies: AttachmentPreviewDependencies,
): Promise<PreparedAttachmentPreview> => {
  const deadline = createAttachmentImportDeadline(
    input.signal,
    dependencies.timeoutMs ?? ATTACHMENT_PREVIEW_TIMEOUT_MS,
  );
  let collected: Awaited<
    ReturnType<typeof collectAttachmentPreviewBody>
  > | undefined;
  let downloadLease: AttachmentDownloadLease | undefined;
  let previewLease: AttachmentPreviewLease | undefined;
  let prepared: Uint8Array | undefined;
  try {
    previewLease = acquireAttachmentPreviewLease(input.subject);
    downloadLease = acquireAttachmentDownloadLease(input.subject);
    const source = await fetchAttachmentImportSource({
      attachmentId: input.attachmentId,
      download: dependencies.download,
      maximumBytes: MAX_RECEIVED_ATTACHMENT_TEXT_PREVIEW_BYTES,
      messageId: input.messageId,
      signal: deadline.signal,
    });
    collected = await collectAttachmentPreviewBody(
      source.body,
      source.size,
      MAX_RECEIVED_ATTACHMENT_TEXT_PREVIEW_BYTES,
      deadline.signal,
    );
    prepared = await inspectTextAttachmentPreview(
      {
        bytes: collected.bytes,
        declaredMimeType: source.mimeType,
        fileName: source.name,
        signal: deadline.signal,
      },
      {
        mimeDetector: dependencies.mimeDetector,
        scanner: dependencies.scanner,
      },
    );
    if (deadline.signal.aborted) {
      throw new ApiError(
        "The attachment preview was cancelled.",
        "ATTACHMENT_PREVIEW_ABORTED",
        499,
      );
    }
    collected.dispose();
    collected = undefined;
    let disposed = false;
    const heldLease = previewLease;
    previewLease = undefined;
    const heldBytes = prepared;
    prepared = undefined;
    return {
      bytes: heldBytes,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        heldBytes.fill(0);
        heldLease.release();
      },
    };
  } catch (error) {
    throw mapFailure(
      error,
      deadline.timedOut(),
      input.signal?.aborted === true,
    );
  } finally {
    prepared?.fill(0);
    collected?.dispose();
    downloadLease?.release();
    previewLease?.release();
    deadline.dispose();
  }
};
