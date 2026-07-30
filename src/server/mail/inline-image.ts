import "server-only";

import { AttachmentDownloadError } from "@/domain/mail/attachment-download-error";
import type {
  AttachmentDownload,
  AttachmentDownloadInput,
} from "@/domain/mail/mail";
import type { AttachmentId, MessageId } from "@/domain/shared/brand";
import type {
  AttachmentMimeDetector,
  AttachmentScanner,
} from "@/server/attachments";
import {
  acquireAttachmentDownloadLease,
  type AttachmentDownloadLease,
} from "@/server/mail/attachment-download-concurrency";
import { collectAttachmentPreviewBody } from "@/server/mail/attachment-preview-body";
import {
  acquireInlineImageLease,
  type InlineImageLease,
} from "@/server/mail/inline-image-concurrency";
import {
  inspectInlineImage,
  type InlineImageNormalizer,
} from "@/server/mail/inline-image-inspection";
import {
  INLINE_IMAGE_MAX_BYTES,
  INLINE_IMAGE_OUTPUT_MIME_TYPE,
} from "@/server/mail/inline-image-raster";
import { asAttachmentDownloadApiError } from "@/server/mail/attachment-download-http";
import { fetchAttachmentImportSource } from "@/server/mail/attachment-import-source";
import { createAttachmentImportDeadline } from "@/server/mail/attachment-import-operation";
import { ApiError } from "@/transport/http/api-error";

export const INLINE_IMAGE_TIMEOUT_MS = 90 * 1_000;

interface InlineImageInput {
  readonly attachmentId: AttachmentId;
  readonly messageId: MessageId;
  readonly signal?: AbortSignal;
  readonly subject: string;
}

export interface InlineImageDependencies {
  readonly download: (
    input: AttachmentDownloadInput,
  ) => Promise<AttachmentDownload>;
  readonly mimeDetector: AttachmentMimeDetector;
  readonly normalizer?: InlineImageNormalizer;
  readonly scanner: AttachmentScanner;
  readonly timeoutMs?: number;
}

export interface PreparedInlineImage {
  readonly bytes: Uint8Array;
  dispose(): void;
  readonly mimeType: typeof INLINE_IMAGE_OUTPUT_MIME_TYPE;
}

const mapFailure = (
  error: unknown,
  timedOut: boolean,
  requestAborted: boolean,
): unknown => {
  if (timedOut) {
    return new ApiError(
      "The inline image took too long to prepare.",
      "INLINE_IMAGE_TIMEOUT",
      504,
    );
  }
  if (requestAborted) {
    return new ApiError(
      "The inline image request was cancelled.",
      "INLINE_IMAGE_ABORTED",
      499,
    );
  }
  if (
    error instanceof AttachmentDownloadError &&
    error.code === "size_limit_exceeded"
  ) {
    return new ApiError(
      "This image is too large to render safely.",
      "INLINE_IMAGE_TOO_LARGE",
      413,
    );
  }
  return error instanceof AttachmentDownloadError
    ? asAttachmentDownloadApiError(error)
    : error;
};

export const prepareInlineImage = async (
  input: InlineImageInput,
  dependencies: InlineImageDependencies,
): Promise<PreparedInlineImage> => {
  const deadline = createAttachmentImportDeadline(
    input.signal,
    dependencies.timeoutMs ?? INLINE_IMAGE_TIMEOUT_MS,
  );
  let collected: Awaited<
    ReturnType<typeof collectAttachmentPreviewBody>
  > | undefined;
  let downloadLease: AttachmentDownloadLease | undefined;
  let inlineLease: InlineImageLease | undefined;
  let prepared: Uint8Array | undefined;
  try {
    inlineLease = acquireInlineImageLease(input.subject);
    downloadLease = acquireAttachmentDownloadLease(input.subject);
    const source = await fetchAttachmentImportSource({
      attachmentId: input.attachmentId,
      download: dependencies.download,
      maximumBytes: INLINE_IMAGE_MAX_BYTES,
      messageId: input.messageId,
      signal: deadline.signal,
    });
    collected = await collectAttachmentPreviewBody(
      source.body,
      source.size,
      INLINE_IMAGE_MAX_BYTES,
      deadline.signal,
    );
    prepared = await inspectInlineImage(
      {
        bytes: collected.bytes,
        declaredMimeType: source.mimeType,
        fileName: source.name,
        signal: deadline.signal,
      },
      {
        mimeDetector: dependencies.mimeDetector,
        ...(dependencies.normalizer
          ? { normalizer: dependencies.normalizer }
          : {}),
        scanner: dependencies.scanner,
      },
    );
    if (deadline.signal.aborted) {
      throw new ApiError(
        "The inline image request was cancelled.",
        "INLINE_IMAGE_ABORTED",
        499,
      );
    }
    collected.dispose();
    collected = undefined;
    let disposed = false;
    const heldBytes = prepared;
    prepared = undefined;
    const heldLease = inlineLease;
    inlineLease = undefined;
    return {
      bytes: heldBytes,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        heldBytes.fill(0);
        heldLease.release();
      },
      mimeType: INLINE_IMAGE_OUTPUT_MIME_TYPE,
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
    inlineLease?.release();
    deadline.dispose();
  }
};
