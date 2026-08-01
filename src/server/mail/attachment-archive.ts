import "server-only";

import type { MailApplicationService } from "@/application/services/mail-application.service";
import { AttachmentDownloadError } from "@/domain/mail/attachment-download-error";
import type {
  MessageAttachmentMetadata,
} from "@/domain/mail/mail";
import { MAX_RECEIVED_ATTACHMENT_DOWNLOAD_BYTES } from "@/domain/mail/received-attachment";
import type { MessageId } from "@/domain/shared/brand";
import type { AttachmentDownloadLease } from "@/server/mail/attachment-download-concurrency";
import {
  assertAttachmentArchiveDownloadSize,
  MAX_ATTACHMENT_ARCHIVE_BYTES,
  MAX_ATTACHMENT_ARCHIVE_ENTRIES,
} from "@/server/mail/attachment-archive-generator";
import { assertAttachmentArchiveMetadata } from "@/server/mail/attachment-archive-metadata";
import { uniqueArchiveEntryNames } from "@/server/mail/attachment-archive-names";
import { attachmentArchiveAbortError } from "@/server/mail/attachment-archive-source";
import { createAttachmentArchiveStream } from "@/server/mail/attachment-archive-stream";
import { stageAttachmentArchiveSources } from "@/server/mail/received-attachment-scan-archive";
import { asReceivedAttachmentScanApiError } from "@/server/mail/received-attachment-scan-http";
import { receivedAttachmentScanSpool } from "@/server/mail/received-attachment-scan-service";
import type { ReceivedAttachmentScanSpool } from "@/server/mail/received-attachment-scan";
import { ApiError } from "@/transport/http/api-error";

const ARCHIVE_TIMEOUT_MS = 10 * 60 * 1_000;
const ARCHIVE_PREFLIGHT_TIMEOUT_MS = 30_000;

interface PrepareAttachmentArchiveInput {
  readonly connectionId: string;
  readonly lease: AttachmentDownloadLease;
  readonly mail: MailApplicationService;
  readonly messageId: MessageId;
  readonly requestSignal: AbortSignal;
  readonly scanSpool?: Pick<ReceivedAttachmentScanSpool, "stage">;
}

interface PreflightAttachmentArchiveInput {
  readonly mail: MailApplicationService;
  readonly messageId: MessageId;
  readonly requestSignal: AbortSignal;
}

const invalidMetadata = (): AttachmentDownloadError =>
  new AttachmentDownloadError(
    "provider_failure",
    "The provider returned invalid attachment metadata.",
  );

const normalizePreparationError = (
  error: unknown,
  signal: AbortSignal,
): AttachmentDownloadError | ApiError => {
  if (error instanceof ApiError || error instanceof AttachmentDownloadError) {
    return error;
  }
  if (signal.aborted) return attachmentArchiveAbortError(signal);
  if (error instanceof Error && error.name === "TimeoutError") {
    return new AttachmentDownloadError(
      "timeout",
      "The mail provider attachment lookup timed out.",
    );
  }
  return new AttachmentDownloadError(
    "provider_failure",
    "The mail provider could not prepare the attachment archive.",
  );
};

const validateAttachments = (
  attachments: readonly MessageAttachmentMetadata[],
): readonly MessageAttachmentMetadata[] => {
  if (attachments.length === 0) {
    throw new ApiError(
      "This message does not have attachments to archive.",
      "ATTACHMENT_ARCHIVE_EMPTY",
      409,
    );
  }
  if (attachments.length > MAX_ATTACHMENT_ARCHIVE_ENTRIES) {
    throw new ApiError(
      "This message has too many attachments to archive.",
      "ATTACHMENT_ARCHIVE_TOO_MANY_ENTRIES",
      413,
    );
  }
  assertAttachmentArchiveMetadata(attachments);
  let knownBytes = 0;
  for (const attachment of attachments) {
    if (attachment.size === null) continue;
    if (!Number.isSafeInteger(attachment.size) || attachment.size < 0) {
      throw invalidMetadata();
    }
    if (attachment.size > MAX_RECEIVED_ATTACHMENT_DOWNLOAD_BYTES) {
      throw new ApiError(
        "An attachment is too large to include in this archive.",
        "ATTACHMENT_ARCHIVE_ENTRY_TOO_LARGE",
        413,
      );
    }
    knownBytes += attachment.size;
    if (
      !Number.isSafeInteger(knownBytes) ||
      knownBytes > MAX_ATTACHMENT_ARCHIVE_BYTES
    ) {
      throw new ApiError(
        "The attachments are too large to archive together.",
        "ATTACHMENT_ARCHIVE_TOO_LARGE",
        413,
      );
    }
  }
  return attachments;
};

const listArchiveAttachments = async (
  mail: MailApplicationService,
  messageId: MessageId,
  signal: AbortSignal,
): Promise<readonly MessageAttachmentMetadata[]> => {
  const attachments = await mail.listMessageAttachments({
    messageId,
    signal,
  });
  if (signal.aborted) throw attachmentArchiveAbortError(signal);
  return validateAttachments(attachments);
};

export const preflightAttachmentArchive = async (
  input: PreflightAttachmentArchiveInput,
): Promise<void> => {
  const signal = AbortSignal.any([
    input.requestSignal,
    AbortSignal.timeout(ARCHIVE_PREFLIGHT_TIMEOUT_MS),
  ]);
  try {
    if (signal.aborted) throw attachmentArchiveAbortError(signal);
    await listArchiveAttachments(input.mail, input.messageId, signal);
  } catch (error) {
    throw normalizePreparationError(error, signal);
  }
};

export const prepareAttachmentArchive = async (
  input: PrepareAttachmentArchiveInput,
): Promise<ReadableStream<Uint8Array>> => {
  const operationController = new AbortController();
  const signal = AbortSignal.any([
    input.requestSignal,
    operationController.signal,
    AbortSignal.timeout(ARCHIVE_TIMEOUT_MS),
  ]);
  let sources: Awaited<ReturnType<typeof stageAttachmentArchiveSources>> | undefined;
  try {
    if (signal.aborted) throw attachmentArchiveAbortError(signal);
    const attachments = await listArchiveAttachments(
      input.mail,
      input.messageId,
      signal,
    );
    if (signal.aborted) throw attachmentArchiveAbortError(signal);
    const names = uniqueArchiveEntryNames(
      attachments.map((attachment) => attachment.name),
    );
    const firstAttachment = attachments[0];
    const firstName = names[0];
    if (!firstAttachment || !firstName) throw invalidMetadata();
    sources = await stageAttachmentArchiveSources({
      attachments,
      connectionId: input.connectionId,
      mail: input.mail,
      messageId: input.messageId,
      signal,
      spool: input.scanSpool ?? await receivedAttachmentScanSpool(),
    });
    const firstDownload = await sources.open(firstAttachment.id, signal);
    assertAttachmentArchiveDownloadSize(firstDownload.size);
    return createAttachmentArchiveStream({
      downloadAttachment: (downloadInput) =>
        sources?.open(downloadInput.attachmentId, downloadInput.signal) ??
        Promise.reject(invalidMetadata()),
      entries: attachments.map((attachment, index) => ({
        attachment,
        name: names[index] ?? "attachment.bin",
      })),
      firstDownload,
      messageId: input.messageId,
      onCancel: (reason) => operationController.abort(reason),
      onFinalize: () => {
        void sources?.dispose();
        input.lease.release();
      },
      signal,
    });
  } catch (error) {
    const normalized = normalizePreparationError(
      asReceivedAttachmentScanApiError(error),
      signal,
    );
    operationController.abort(error);
    try {
      await sources?.dispose();
    } finally {
      input.lease.release();
    }
    throw normalized;
  }
};
