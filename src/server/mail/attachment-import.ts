import "server-only";

import { AttachmentDownloadError } from "@/domain/mail/attachment-download-error";
import type { AttachmentDownload, AttachmentDownloadInput } from "@/domain/mail/mail";
import { sanitizeReceivedAttachmentName } from "@/domain/mail/received-attachment";
import type { AttachmentId, MessageId } from "@/domain/shared/brand";
import {
  type AttachmentQuarantine,
  AttachmentQuarantineError,
  defaultAttachmentQuotas,
  type AttachmentScope,
  type AttachmentSnapshot,
} from "@/server/attachments";
import {
  acquireAttachmentDownloadLease,
  type AttachmentDownloadLease,
} from "@/server/mail/attachment-download-concurrency";
import { cleanupAttachmentImport } from "@/server/mail/attachment-import-cleanup";
import {
  collectAttachmentBody,
  type CollectedAttachmentBody,
  createAttachmentImportDeadline,
} from "@/server/mail/attachment-import-operation";
import {
  attachmentImportProviderFailure,
  fetchAttachmentImportSource,
} from "@/server/mail/attachment-import-source";
import { asAttachmentDownloadApiError } from "@/server/mail/attachment-download-http";
import {
  type AttachmentSendMemoryBudget,
  attachmentSendMemoryBudget,
  type AttachmentSendMemoryLease,
} from "@/server/mail/attachment-send-memory-budget";
import {
  asAttachmentApiError,
} from "@/server/mail/attachment-service";
import { ApiError } from "@/transport/http/api-error";

interface AttachmentImportInput {
  readonly attachmentId: AttachmentId;
  readonly messageId: MessageId;
  readonly scope: AttachmentScope;
  readonly signal?: AbortSignal;
  readonly subject: string;
}

export interface AttachmentImportDependencies {
  readonly download: (
    input: AttachmentDownloadInput,
  ) => Promise<AttachmentDownload>;
  readonly maximumBytes: number;
  readonly memoryBudget?: Pick<AttachmentSendMemoryBudget, "acquire">;
  readonly quarantine: Pick<
    AttachmentQuarantine,
    "remove" | "reserve" | "upload"
  >;
  readonly timeoutMs?: number;
}

const importBusy = (): ApiError =>
  new ApiError(
    "Attachment forwarding is busy. Please wait and try again.",
    "ATTACHMENT_IMPORT_BUSY",
    503,
  );

const importAborted = (): AttachmentDownloadError =>
  new AttachmentDownloadError(
    "aborted",
    "The attachment import was cancelled.",
  );

export const mapAttachmentImportFailure = (
  error: unknown,
  timedOut: boolean,
  requestAborted: boolean,
): unknown => {
  if (timedOut) {
    return new AttachmentDownloadError(
      "timeout",
      "The attachment import timed out.",
    );
  }
  if (requestAborted) {
    return new AttachmentDownloadError(
      "aborted",
      "The attachment import was cancelled.",
    );
  }
  if (
    error instanceof AttachmentQuarantineError &&
    ["ATTACHMENT_LENGTH_MISMATCH", "INVALID_ATTACHMENT_BODY"].includes(
      error.code,
    )
  ) {
    return attachmentImportProviderFailure();
  }
  return error;
};

export const importReceivedAttachment = async (
  input: AttachmentImportInput,
  dependencies: AttachmentImportDependencies,
): Promise<AttachmentSnapshot> => {
  if (
    !Number.isSafeInteger(dependencies.maximumBytes) ||
    dependencies.maximumBytes < 1 ||
    dependencies.maximumBytes > defaultAttachmentQuotas.maxFileBytes
  ) {
    throw new RangeError("Attachment import byte limit is invalid.");
  }
  const deadline = createAttachmentImportDeadline(
    input.signal,
    dependencies.timeoutMs,
  );
  let collected: CollectedAttachmentBody | undefined;
  let downloadLease: AttachmentDownloadLease | undefined;
  let memoryLease: AttachmentSendMemoryLease | undefined;
  let pendingBody: ReadableStream<Uint8Array> | undefined;
  let reserved: AttachmentSnapshot | undefined;
  try {
    memoryLease = await (
      dependencies.memoryBudget ?? attachmentSendMemoryBudget()
    ).acquire(
      dependencies.maximumBytes,
      {
        abortError: importAborted,
        busyError: importBusy,
        signal: deadline.signal,
      },
    );
    downloadLease = acquireAttachmentDownloadLease(input.subject);
    const source = await fetchAttachmentImportSource({
      attachmentId: input.attachmentId,
      download: dependencies.download,
      maximumBytes: dependencies.maximumBytes,
      messageId: input.messageId,
      signal: deadline.signal,
    });
    pendingBody = source.body;
    collected = await collectAttachmentBody(
      source.body,
      source.size,
      dependencies.maximumBytes,
      deadline.signal,
    );
    pendingBody = undefined;
    reserved = await dependencies.quarantine.reserve({
      contentLength: collected.size,
      declaredMimeType: source.mimeType,
      fileName: sanitizeReceivedAttachmentName(source.name),
      scope: input.scope,
    });
    const imported = await dependencies.quarantine.upload(
      reserved.id,
      input.scope,
      collected.body,
      collected.size,
      deadline.signal,
    );
    if (deadline.signal.aborted) {
      throw importAborted();
    }
    return imported;
  } catch (error) {
    const failedReservation = reserved;
    await cleanupAttachmentImport({
      ...(pendingBody ? { body: pendingBody } : {}),
      reason: error,
      ...(failedReservation
        ? {
            remove: () =>
              dependencies.quarantine.remove(
                failedReservation.id,
                input.scope,
              ),
          }
        : {}),
    });
    throw mapAttachmentImportFailure(
      error,
      deadline.timedOut(),
      input.signal?.aborted === true,
    );
  } finally {
    collected?.dispose();
    deadline.dispose();
    downloadLease?.release();
    memoryLease?.release();
  }
};

export const asAttachmentImportApiError = (error: unknown): unknown =>
  error instanceof AttachmentDownloadError
    ? asAttachmentDownloadApiError(error)
    : asAttachmentApiError(error);
